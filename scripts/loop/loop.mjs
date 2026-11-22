#!/usr/bin/env node
/**
 * Orchestrator side of the engineering loop (see scripts/loop/README.md).
 *
 *   node scripts/loop/loop.mjs new <id> --brief <file> [--branch feat/x] [--base main]
 *                                  [--worktree <path>] [--model pro|flash|flash_lite] [--title "..."]
 *                                  [--max-rounds N] [--budget-minutes N]
 *   node scripts/loop/loop.mjs resume <id> [--model pro|flash|flash_lite] [--title "..."]
 *   node scripts/loop/loop.mjs feedback <id> --file <file>
 *   node scripts/loop/loop.mjs status [id]
 *   node scripts/loop/loop.mjs wait <id> [--timeout <seconds>]
 *   node scripts/loop/loop.mjs verify <id> [--round N] [--build]
 *   node scripts/loop/loop.mjs audit <id>
 *   node scripts/loop/loop.mjs close <id> --merged|--abandoned
 *   node scripts/loop/loop.mjs metrics
 *
 * `new` prepares a git worktree, writes the full brief (loop protocol + task) to
 * .loop/tasks/<id>/brief.md and queues it for the bridge. Antigravity reports in
 * .loop/tasks/<id>/report-<round>.md; `wait` returns when that report is final.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scanWorktreeGaming } from "./lib/detector.mjs";
import {
  appendMetric,
  computeMetricsSummary,
  formatMetricsReport,
  readMetrics,
} from "./lib/metrics.mjs";
import {
  canResumeTask,
  checkBudget,
  checkRoundCap,
  checkWaitStatus,
  closeTask,
  DEFAULT_BUDGET_MINUTES,
  DEFAULT_MAX_ROUNDS,
  escalateTask,
  formatResumePrompt,
  getExpectedRound,
  getLatestReport,
} from "./lib/rounds.mjs";
import { buildTaskStatusInfo, formatStatusReport, formatTaskDetail } from "./lib/status.mjs";
import { formatVerifySummary, runVerify } from "./lib/verifier.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
function findLoopDir(repo) {
  if (process.env.LOOP_DIR) return path.resolve(process.env.LOOP_DIR);
  const direct = path.join(repo, ".loop");
  if (fs.existsSync(direct)) return direct;
  try {
    const common = execFileSync("git", ["-C", repo, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (common) {
      const candidate = path.resolve(common, "..", ".loop");
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // fallback
  }
  return direct;
}
const LOOP = findLoopDir(REPO);
const QUEUE = path.join(LOOP, "queue");
const TASKS = path.join(LOOP, "tasks");

const [, , cmd, rawId, ...rest] = process.argv;
export const id = rawId && !rawId.startsWith("--") ? rawId : undefined;

export function parseFlags(argvRest) {
  const flags = {};
  for (let i = 0; i < argvRest.length; i++) {
    const arg = argvRest[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argvRest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return flags;
}

const flags = parseFlags(rawId && rawId.startsWith("--") ? [rawId, ...rest] : rest);

const taskDir = (t) => path.join(TASKS, t);
const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
};
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const git = (...args) => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" }).trim();

function enqueue(job) {
  fs.mkdirSync(QUEUE, { recursive: true });
  const file = path.join(QUEUE, `${Date.now()}-${job.taskId}-${job.op}.json`);
  fs.writeFileSync(file, JSON.stringify(job, null, 2));
  return file;
}

function bridgeHealth() {
  const hb = readJson(path.join(LOOP, "bridge.json"), null);
  if (!hb)
    return "bridge has never run — start it from an Antigravity terminal: node scripts/loop/bridge.mjs";
  const age = (Date.now() - Date.parse(hb.beatAt)) / 1000;
  if (age < 15 && typeof hb.agentapi === "string")
    return `bridge OUTDATED (pid ${hb.pid}) — stop it and start node scripts/loop/bridge.mjs again`;
  return age < 15
    ? `bridge alive (pid ${hb.pid})`
    : `bridge NOT running (last heartbeat ${Math.round(age)}s ago)`;
}

const DEFAULT_BASE_BRANCH = "main";
const WORKSPACE_CLAUDE_MD = path.resolve(REPO, "..", "CLAUDE.md");

export function protocol({ taskId, worktree, branch, base, round }) {
  const out = taskDir(taskId);
  const claudeMdLocation = fs.existsSync(path.join(REPO, "CLAUDE.md"))
    ? "`CLAUDE.md` in the worktree"
    : `\`${WORKSPACE_CLAUDE_MD}\` (project constitution)`;
  return `# Loop task \`${taskId}\`

You are the implementing engineer. Claude Code is the orchestrator and reviewer: it reads your report and your commits, runs the gates itself, and sends you feedback rounds until the work is merged.

## Where to work
- Work ONLY inside the git worktree \`${worktree}\` (branch \`${branch}\`, based on \`${base}\`). Use that folder as the working directory for every command and every file edit.
- Never edit the main checkout \`${REPO}\` or any other worktree. Never switch branches, push, open PRs or merge.
- If the worktree already has commits or uncommitted changes, that is earlier partial work on this same task: review it, keep what is right, finish it.
- If \`node_modules\` is missing in the worktree, run \`vp install --frozen-lockfile\` (or \`vp install\`) there first.

## Rules
- Read ${claudeMdLocation} and \`AGENTS.md\` in the worktree first. This is a Vite+ monorepo (NestJS 12 ESM API in \`api/\` + React 19 Vite Web in \`web/\`); follow Clean Architecture, Spec-Driven Development (\`docs/specs/\`), and Spanish error code rules in \`CLAUDE.md\`, and check \`node_modules/vite-plus/docs/\` for Vite+ specifics.
- Match the surrounding code's style, naming and comment density. Commit in logical steps with clear messages.
- Tests never call paid APIs or real external services. Never print, log or commit secrets.
- If a product decision blocks you, take the conservative option, write it under "Decisions" in your report, and keep going.
- Never edit \`scripts/loop/**\`, CI, \`.vite-hooks/**\`, \`vite.config.*\`, or lint/test config unless the task says so.
- Never skip, delete or weaken tests to make gates pass; if a test is wrong, say so in the report.

## Gates (all must pass before you report ready-for-review)
Run in the worktree and paste the last lines of each into the report:
1. \`vp check\`
2. \`vp run -r test\`
3. \`vp -C api run test:e2e\`
4. \`vp run -r build\` (if the task asks for build verification or touches build/config).

## Reporting back
When done (or truly blocked), write \`${path.join(out, `report-${round}.md`)}\` with:
- **Summary** (what changed, 3–8 bullets)
- **Commits** (\`git log --oneline ${base}..HEAD\`)
- **Acceptance** (each acceptance item ✅/❌ with one line)
- **Gates** (results)
- **Decisions / open questions**
- The very last line exactly \`LOOP-STATUS: ready-for-review\` or \`LOOP-STATUS: blocked\`.

Feedback arrives as a new message pointing to \`feedback-<n>.md\` in the same folder. Address every item, commit, re-run the gates, and answer with \`report-<n>.md\` in the same format.

---

`;
}

function cmdNew() {
  if (!id || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(id))
    fail("Task id: 2–41 chars, lowercase letters, digits, dashes");
  if (!flags.brief) fail("--brief <file> is required");
  const brief = fs.readFileSync(flags.brief, "utf8");
  const base = flags.base ?? DEFAULT_BASE_BRANCH;
  let worktree = flags.worktree ? path.resolve(flags.worktree) : path.join(LOOP, "wt", id);
  let branch = flags.branch ?? `feat/${id}`;
  if (fs.existsSync(worktree)) {
    branch = execFileSync("git", ["-C", worktree, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } else {
    git("worktree", "add", worktree, "-b", branch, base);
  }

  const maxRounds = Number(flags["max-rounds"] ?? flags.maxRounds ?? DEFAULT_MAX_ROUNDS);
  const budgetMinutes = Number(
    flags["budget-minutes"] ?? flags.budgetMinutes ?? DEFAULT_BUDGET_MINUTES,
  );

  fs.mkdirSync(taskDir(id), { recursive: true });
  const briefPath = path.join(taskDir(id), "brief.md");
  fs.writeFileSync(briefPath, protocol({ taskId: id, worktree, branch, base, round: 0 }) + brief);
  fs.writeFileSync(
    path.join(taskDir(id), "task.json"),
    JSON.stringify(
      {
        taskId: id,
        worktree,
        branch,
        base,
        createdAt: new Date().toISOString(),
        maxRounds,
        budgetMinutes,
      },
      null,
      2,
    ),
  );

  const prompt = `You have a new engineering task. Read the task brief at ${briefPath} and carry it out exactly. It says where to work and how to report back.`;
  enqueue({
    op: "new",
    taskId: id,
    round: 0,
    model: flags.model ?? "pro",
    title: flags.title ?? `loop: ${id}`,
    prompt,
  });
  console.log(
    `queued ${id}\n  worktree ${worktree} (${branch})\n  brief    ${briefPath}\n  ${bridgeHealth()}`,
  );
}

function cmdFeedback() {
  if (!id || !flags.file) fail("usage: feedback <id> --file <file>");
  const task = readJson(path.join(taskDir(id), "task.json"), {});
  const state = readJson(path.join(taskDir(id), "state.json"), {});

  const maxRounds = task.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const round = (state.round ?? 0) + 1;

  // Round cap check
  const capCheck = checkRoundCap({ round, maxRounds });
  if (!capCheck.allowed) {
    const { message } = escalateTask({ taskId: id, round, maxRounds, state });
    fs.mkdirSync(taskDir(id), { recursive: true });
    fs.writeFileSync(path.join(taskDir(id), "state.json"), JSON.stringify(state, null, 2));
    appendMetric(LOOP, {
      event: "escalated",
      taskId: id,
      round,
      reason: state.escalationReason,
    });
    console.log(message);
    return;
  }

  const fbPath = path.join(taskDir(id), `feedback-${round}.md`);
  fs.writeFileSync(
    fbPath,
    `# Review feedback, round ${round}\n\nAddress every item, commit, re-run the gates, then write report-${round}.md (same format as before, ending with the LOOP-STATUS line).\n\n` +
      fs.readFileSync(flags.file, "utf8"),
  );
  const prompt = `Review feedback round ${round} for task ${id} is ready at ${fbPath}. Read it, fix everything it lists in the same worktree, and write report-${round}.md next to it as the brief describes.`;
  enqueue({ op: "send", taskId: id, round, prompt });
  console.log(`queued feedback round ${round} for ${id}\n  ${bridgeHealth()}`);
}

function cmdStatus() {
  const queuedFiles = fs.existsSync(QUEUE)
    ? fs
        .readdirSync(QUEUE)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
  const queuedJobs = queuedFiles.map((qf) => readJson(path.join(QUEUE, qf), {}));

  const ids = id ? [id] : fs.existsSync(TASKS) ? fs.readdirSync(TASKS) : [];
  const tasks = [];
  for (const t of ids) {
    const dir = taskDir(t);
    const task = readJson(path.join(dir, "task.json"), {});
    const state = readJson(path.join(dir, "state.json"), {});
    tasks.push(buildTaskStatusInfo({ taskId: t, taskDir: dir, task, state }));
  }

  if (id) {
    console.log(bridgeHealth());
    if (tasks.length > 0) {
      console.log(formatTaskDetail(tasks[0]));
    } else {
      console.log(`\nTask not found: ${id}`);
    }
    return;
  }

  const output = formatStatusReport({
    bridgeHealthText: bridgeHealth(),
    queuedJobs,
    tasks,
    all: Boolean(flags.all),
  });
  console.log(output.trimEnd());
}

async function cmdWait() {
  if (!id) fail("usage: wait <id> [--timeout <seconds>]");
  const dir = taskDir(id);
  const task = readJson(path.join(dir, "task.json"), {});
  const budgetMinutes = task.budgetMinutes ?? DEFAULT_BUDGET_MINUTES;
  const deadline = Date.now() + Number(flags.timeout ?? 3600) * 1000;

  for (;;) {
    const state = readJson(path.join(dir, "state.json"), {});
    const expectedRound = getExpectedRound(state, dir);
    const isDelivering = expectedRound > (state.round ?? 0);

    // Time budget check per round
    const roundStart = state.roundStartedAt || task.createdAt;
    if (roundStart) {
      const budgetInfo = checkBudget({ startedAt: roundStart, budgetMinutes });
      if (budgetInfo.overBudget) {
        state.status = "over_budget";
        state.overBudgetAt = new Date().toISOString();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
        fail(
          `${id}: over_budget (round elapsed ${budgetInfo.elapsedMinutes}m exceeded ${budgetMinutes}m budget)`,
        );
      }
    }

    const r = getLatestReport(dir, expectedRound);
    const waitStatus = checkWaitStatus({ state, report: r, isDelivering });
    if (waitStatus.action === "exit_error") {
      fail(`${id}: ${waitStatus.status} — ${waitStatus.reason}`);
    }
    if (waitStatus.action === "done") {
      console.log(`${id} round ${r.round}: ${r.status}\n${r.path}`);
      return;
    }

    if (Date.now() > deadline)
      fail(`${id}: timed out waiting for report-${expectedRound}.md (${bridgeHealth()})`);
    await new Promise((res) => setTimeout(res, 15_000));
  }
}

async function cmdVerify() {
  if (!id) fail("usage: verify <id> [--round N] [--build]");
  const dir = taskDir(id);
  const task = readJson(path.join(dir, "task.json"), {});
  const state = readJson(path.join(dir, "state.json"), {});
  const worktree = task.worktree || path.join(LOOP, "wt", id);
  if (!fs.existsSync(worktree)) fail(`worktree does not exist: ${worktree}`);

  const expectedRound = getExpectedRound(state, dir);
  const round = flags.round !== undefined ? Number(flags.round) : expectedRound;
  const result = await runVerify({
    taskId: id,
    worktree,
    base: task.base || DEFAULT_BASE_BRANCH,
    round,
    build: Boolean(flags.build),
    loopDir: LOOP,
  });

  console.log(
    formatVerifySummary({
      taskId: id,
      round,
      passed: result.passed,
      gates: result.gates,
      findings: result.findings,
    }),
  );

  if (!result.passed) {
    process.exit(1);
  }
}

function cmdAudit() {
  if (!id) fail("usage: audit <id>");
  const task = readJson(path.join(taskDir(id), "task.json"), {});
  const worktree = task.worktree || path.join(LOOP, "wt", id);
  if (!fs.existsSync(worktree)) fail(`worktree does not exist: ${worktree}`);

  const { findings } = scanWorktreeGaming(worktree, task.base || DEFAULT_BASE_BRANCH);
  console.log(`\n=== Gaming Detector Audit: ${id} ===`);
  console.log(`Findings: ${findings.length}`);
  for (const f of findings) {
    console.log(`  - ${f.file}:${f.line} [${f.rule}]${f.detail ? ` - ${f.detail}` : ""}`);
  }
}

function cmdClose() {
  if (!id || (!flags.merged && !flags.abandoned)) {
    fail("usage: close <id> --merged | --abandoned");
  }
  const outcome = flags.merged ? "merged" : "abandoned";
  const state = readJson(path.join(taskDir(id), "state.json"), { taskId: id, history: [] });

  closeTask({ taskId: id, outcome, state });
  fs.mkdirSync(taskDir(id), { recursive: true });
  fs.writeFileSync(path.join(taskDir(id), "state.json"), JSON.stringify(state, null, 2));

  appendMetric(LOOP, {
    event: "closed",
    taskId: id,
    result: outcome,
  });

  console.log(`Task ${id} has been marked as ${outcome}.`);
}

function cmdMetrics() {
  const events = readMetrics(LOOP);
  const summary = computeMetricsSummary(events);
  console.log(formatMetricsReport(summary));
}

function cmdResume() {
  if (!id) fail("usage: resume <id> [--model <model>] [--title <title>]");
  const dir = taskDir(id);
  if (!fs.existsSync(dir)) fail(`task directory not found: ${dir}`);
  const task = readJson(path.join(dir, "task.json"), null);
  if (!task) fail(`task metadata not found for ${id}`);
  const state = readJson(path.join(dir, "state.json"), { taskId: id, history: [] });

  const check = canResumeTask(state);
  if (!check.allowed) {
    fail(`cannot resume ${id}: ${check.reason}`);
  }

  const round = getExpectedRound(state, dir);
  const prompt = formatResumePrompt({ taskId: id, round, taskDir: dir });

  enqueue({
    op: "resume",
    taskId: id,
    round,
    model: flags.model ?? task.model ?? "pro",
    title: flags.title ?? `loop: ${id} (resumed)`,
    prompt,
  });

  console.log(`queued resume for ${id} (round ${round})\n  prompt: ${prompt}\n  ${bridgeHealth()}`);
}

const commands = {
  new: cmdNew,
  feedback: cmdFeedback,
  status: cmdStatus,
  wait: cmdWait,
  verify: cmdVerify,
  audit: cmdAudit,
  close: cmdClose,
  metrics: cmdMetrics,
  resume: cmdResume,
};

if (!commands[cmd]) {
  fail(
    "commands: new | feedback | status | wait | verify | audit | close | metrics | resume  (see the header of scripts/loop/loop.mjs)",
  );
}

await commands[cmd]();
