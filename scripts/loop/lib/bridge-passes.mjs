/**
 * Bridge worker pass implementations and job dispatch logic.
 *
 * Implements inertness for closed tasks (merged, abandoned) and prevents
 * stale write overwrites across asynchronous agentapi calls.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isConversationLost, WRONG_SERVER_PATTERN } from "./classifier.mjs";
import { appendMetric } from "./metrics.mjs";
import {
  canResumeTask,
  checkBudget,
  DEFAULT_BUDGET_MINUTES,
  getExpectedRound,
  getLatestReport,
  markConversationLost,
  prepareTaskForResume,
} from "./rounds.mjs";
import { evaluateTaskStall, formatNudgePrompt } from "./stall.mjs";
import { isTaskClosed, readState, updateState } from "./state.mjs";
import { isTaskRunningWithoutFinalReport } from "./wip.mjs";

const defaultRepoDir = () =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const defaultLoopDir = () =>
  process.env.LOOP_DIR ? path.resolve(process.env.LOOP_DIR) : path.join(defaultRepoDir(), ".loop");
const defaultTasksDir = () => path.join(defaultLoopDir(), "tasks");

export const WRONG_SERVER = WRONG_SERVER_PATTERN;
export const ownedByConfig = (state) => state?.server !== "env";

export function findConversationId(value) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const stack = [value];
  let fallback = null;
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object") continue;
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" && /conversation_?id|cascade_?id|trajectory_?id/i.test(k)) return x;
      if (typeof x === "string" && uuid.test(x)) fallback ??= x;
      if (x && typeof x === "object") stack.push(x);
    }
  }
  return fallback;
}

export function countRunningTasksWithoutFinalReport({ tasksDir = defaultTasksDir() } = {}) {
  if (!fs.existsSync(tasksDir)) return 0;
  let count = 0;
  for (const id of fs.readdirSync(tasksDir)) {
    const state = readState(id, { tasksDir });
    const dir = path.join(tasksDir, id);
    const expectedRound = getExpectedRound(state, dir);
    const rep = getLatestReport(dir, expectedRound);
    if (isTaskRunningWithoutFinalReport(state, rep.status)) {
      count++;
    }
  }
  return count;
}

export async function handleJob(
  job,
  {
    tasksDir = defaultTasksDir(),
    loopDir = defaultLoopDir(),
    agentapi,
    log = console.log,
    mtimeTracker,
    appendMetric: appendMetricFn = appendMetric,
  } = {},
) {
  const at = new Date().toISOString();

  if (job.op === "new") {
    const initial = readState(job.taskId, { tasksDir });
    if (isTaskClosed(initial)) {
      log(job.taskId, `REFUSED new: task is closed (${initial.status})`);
      return;
    }

    const args = ["new-conversation"];
    if (job.model) args.push(`--model=${job.model}`);
    if (job.title) args.push(`--title=${job.title}`);
    args.push(job.prompt);
    let res = await agentapi(args);
    let server = "env";
    if (!res.ok && WRONG_SERVER.test(res.err ?? "")) {
      log(job.taskId, "env server has no project store; retrying with the saved IDE credentials");
      res = await agentapi(args, { preferConfig: true });
      server = "config";
    }

    const conversationId = res.json ? findConversationId(res.json) : null;
    let wasClosed = false;

    updateState(
      job.taskId,
      (fresh) => {
        if (isTaskClosed(fresh)) {
          wasClosed = true;
          log(
            job.taskId,
            `ignoring new result: task was closed (${fresh.status}) during new-conversation`,
          );
          return false;
        }
        if (res.ok) fresh.server = server;
        fresh.conversationId = conversationId ?? fresh.conversationId ?? null;
        fresh.status = res.ok ? "running" : "dispatch_failed";
        fresh.round = job.round ?? 0;
        if (res.ok) {
          fresh.roundStartedAt = at;
          delete fresh.nudgedAt;
          delete fresh.stalledAt;
          delete fresh.stalledReason;
        }
        (fresh.history ??= []).push({
          at,
          op: "new",
          ok: res.ok,
          response: res.json ?? res.out,
          error: res.ok ? undefined : res.err,
        });
      },
      { tasksDir },
    );

    if (res.ok && !wasClosed) {
      if (mtimeTracker) mtimeTracker.clear(job.taskId);
      if (appendMetricFn && loopDir) {
        appendMetricFn(loopDir, {
          event: "dispatched",
          taskId: job.taskId,
          model: job.model ?? "pro",
        });
      }
    }

    log(
      job.taskId,
      res.ok
        ? `started conversation ${conversationId ?? "(id not found in response)"}`
        : `FAILED: ${res.err}`,
    );
    return;
  }

  if (job.op === "send") {
    const initial = readState(job.taskId, { tasksDir });
    if (isTaskClosed(initial)) {
      log(job.taskId, `REFUSED send: task is closed (${initial.status})`);
      return;
    }
    if (!initial.conversationId) {
      updateState(
        job.taskId,
        (fresh) => {
          if (isTaskClosed(fresh)) return false;
          (fresh.history ??= []).push({
            at,
            op: "send",
            ok: false,
            error: "no conversation id for this task",
          });
        },
        { tasksDir },
      );
      log(job.taskId, "FAILED: no conversation id");
      return;
    }
    const convId = initial.conversationId;
    const isConfig = ownedByConfig(initial);
    const targetServer = isConfig ? "config" : "env";
    const owningServer = initial.server ?? "config";

    const res = await agentapi(["send-message", convId, job.prompt], { preferConfig: isConfig });

    let wasClosed = false;
    let wasLost = false;

    updateState(
      job.taskId,
      (fresh) => {
        if (isTaskClosed(fresh)) {
          wasClosed = true;
          log(
            job.taskId,
            `ignoring send result: task was closed (${fresh.status}) during send-message`,
          );
          return false;
        }
        if (!res.ok && isConversationLost(res.err, { server: targetServer, owningServer })) {
          wasLost = true;
          markConversationLost({ state: fresh, error: res.err, at });
          (fresh.history ??= []).push({
            at,
            op: "send",
            round: job.round,
            ok: false,
            response: res.json ?? res.out,
            error: res.err,
          });
          return;
        }
        fresh.status = res.ok ? "running" : "send_failed";
        fresh.round = job.round ?? fresh.round;
        if (res.ok) {
          fresh.roundStartedAt = at;
          delete fresh.nudgedAt;
          delete fresh.stalledAt;
          delete fresh.stalledReason;
        }
        (fresh.history ??= []).push({
          at,
          op: "send",
          round: job.round,
          ok: res.ok,
          response: res.json ?? res.out,
          error: res.ok ? undefined : res.err,
        });
      },
      { tasksDir },
    );

    if (wasClosed) return;

    if (wasLost) {
      if (appendMetricFn && loopDir) {
        appendMetricFn(loopDir, {
          event: "conversation_lost",
          taskId: job.taskId,
          round: job.round ?? 0,
          error: res.err,
        });
      }
      log(job.taskId, `conversation lost: ${res.err}`);
      return;
    }

    if (res.ok) {
      if (mtimeTracker) mtimeTracker.clear(job.taskId);
      if (appendMetricFn && loopDir) {
        appendMetricFn(loopDir, {
          event: "feedback",
          taskId: job.taskId,
          round: job.round,
        });
      }
    }

    log(job.taskId, res.ok ? `sent round ${job.round}` : `FAILED: ${res.err}`);
    return;
  }

  if (job.op === "resume") {
    const initial = readState(job.taskId, { tasksDir });
    const resumeCheck = canResumeTask(initial);
    if (!resumeCheck.allowed) {
      log(job.taskId, `REFUSED resume: ${resumeCheck.reason}`);
      return;
    }

    const args = ["new-conversation"];
    if (job.model) args.push(`--model=${job.model}`);
    if (job.title) args.push(`--title=${job.title}`);
    args.push(job.prompt);

    let res = await agentapi(args);
    let server = "env";
    if (!res.ok && WRONG_SERVER.test(res.err ?? "")) {
      log(job.taskId, "env server has no project store; retrying with the saved IDE credentials");
      res = await agentapi(args, { preferConfig: true });
      server = "config";
    }

    let wasClosed = false;
    const conversationId = res.json ? findConversationId(res.json) : null;

    updateState(
      job.taskId,
      (fresh) => {
        if (isTaskClosed(fresh)) {
          wasClosed = true;
          log(
            job.taskId,
            `ignoring resume result: task was closed (${fresh.status}) during resume`,
          );
          return false;
        }
        if (res.ok) {
          prepareTaskForResume({
            state: fresh,
            newConversationId: conversationId,
            server,
            round: job.round ?? fresh.round ?? 0,
            at,
          });
          (fresh.history ??= []).push({
            at,
            op: "resume",
            round: job.round,
            ok: true,
            response: res.json ?? res.out,
          });
        } else {
          fresh.status = "dispatch_failed";
          (fresh.history ??= []).push({
            at,
            op: "resume",
            round: job.round,
            ok: false,
            response: res.json ?? res.out,
            error: res.err,
          });
        }
      },
      { tasksDir },
    );

    if (wasClosed) return;

    if (res.ok) {
      if (mtimeTracker) mtimeTracker.clear(job.taskId);
      if (appendMetricFn && loopDir) {
        appendMetricFn(loopDir, {
          event: "resumed",
          taskId: job.taskId,
          round: job.round,
          model: job.model ?? "pro",
        });
      }
      log(job.taskId, `resumed conversation ${conversationId ?? "(id not found in response)"}`);
    } else {
      log(job.taskId, `FAILED to resume: ${res.err}`);
    }
    return;
  }
}

export function checkActiveTasksBudgetAndReports({
  tasksDir = defaultTasksDir(),
  loopDir = defaultLoopDir(),
  log = console.log,
  appendMetric: appendMetricFn = appendMetric,
  now = Date.now(),
} = {}) {
  if (!tasksDir || !fs.existsSync(tasksDir)) return;
  for (const id of fs.readdirSync(tasksDir)) {
    const state = readState(id, { tasksDir });
    if (isTaskClosed(state) || state.status !== "running") continue;

    // 1. Budget check per round: measures from roundStartedAt (fallback to createdAt)
    try {
      const taskPath = path.join(tasksDir, id, "task.json");
      const task = fs.existsSync(taskPath) ? JSON.parse(fs.readFileSync(taskPath, "utf8")) : {};
      const budgetMinutes = task.budgetMinutes ?? DEFAULT_BUDGET_MINUTES;
      if (budgetMinutes > 0) {
        const roundStart = state.roundStartedAt || task.createdAt;
        const budgetInfo = checkBudget({
          startedAt: roundStart,
          createdAt: task.createdAt,
          budgetMinutes,
          now,
        });
        if (budgetInfo.overBudget) {
          updateState(
            id,
            (fresh) => {
              if (isTaskClosed(fresh) || fresh.status !== "running") return false;
              fresh.status = "over_budget";
              fresh.overBudgetAt = new Date(now).toISOString();
            },
            { tasksDir },
          );
          log(
            id,
            `marked over_budget (round elapsed ${budgetInfo.elapsedMinutes}m > ${budgetInfo.budgetMinutes}m)`,
          );
          continue;
        }
      }
    } catch (e) {
      log(id, `budget check error: ${e.message}`);
    }

    // 2. Check for newly written reports
    const dir = path.join(tasksDir, id);
    const expectedRound = getExpectedRound(state, dir);
    const rep = getLatestReport(dir, expectedRound);
    if (
      (rep.status === "ready-for-review" || rep.status === "blocked") &&
      state.lastReportedRound !== rep.round
    ) {
      let reported = false;
      updateState(
        id,
        (fresh) => {
          if (isTaskClosed(fresh) || fresh.status !== "running") return false;
          fresh.lastReportedRound = rep.round;
          fresh.lastReportStatus = rep.status;
          reported = true;
        },
        { tasksDir },
      );
      if (reported) {
        if (appendMetricFn && loopDir) {
          appendMetricFn(loopDir, {
            event: "report",
            taskId: id,
            round: rep.round,
            status: rep.status,
          });
        }
        log(id, `report round ${rep.round}: ${rep.status}`);
      }
    }
  }
}

export async function checkActiveTasksStall({
  tasksDir = defaultTasksDir(),
  loopDir = defaultLoopDir(),
  agentapi,
  log = console.log,
  mtimeTracker,
  appendMetric: appendMetricFn = appendMetric,
  now = Date.now(),
  walkFiles,
} = {}) {
  if (!tasksDir || !fs.existsSync(tasksDir)) return;

  for (const id of fs.readdirSync(tasksDir)) {
    const state = readState(id, { tasksDir });
    if (isTaskClosed(state) || state.status !== "running") continue;

    const dir = path.join(tasksDir, id);
    let task = {};
    try {
      const taskPath = path.join(dir, "task.json");
      if (fs.existsSync(taskPath)) task = JSON.parse(fs.readFileSync(taskPath, "utf8"));
    } catch {
      /* ignore */
    }

    const expectedRound = getExpectedRound(state, dir);
    const rep = getLatestReport(dir, expectedRound);

    const stallEval = evaluateTaskStall({
      task,
      state,
      reportStatus: rep.status,
      mtimeTracker,
      now,
      walkFiles,
    });

    if (stallEval.action === "nudge") {
      const currentRound = state.round ?? 0;
      const prompt = formatNudgePrompt({
        round: currentRound,
        stallMinutes: stallEval.stallMinutes,
      });

      if (!state.conversationId) {
        log(id, `stall detected but no conversationId to nudge`);
        continue;
      }

      const convId = state.conversationId;
      const isConfig = ownedByConfig(state);
      const targetServer = isConfig ? "config" : "env";
      const owningServer = state.server ?? "config";

      log(
        id,
        `stall detected (inactive ${stallEval.elapsedSinceActivityMinutes}m >= ${stallEval.stallMinutes}m) -> sending auto-nudge`,
      );
      const res = await agentapi(["send-message", convId, prompt], {
        preferConfig: isConfig,
      });

      const at = new Date(now).toISOString();
      let wasClosed = false;
      let wasLost = false;
      let nudgeSaved = false;

      updateState(
        id,
        (fresh) => {
          if (isTaskClosed(fresh) || fresh.status !== "running") {
            wasClosed = true;
            log(id, `ignoring nudge result: task was closed (${fresh.status}) during nudge`);
            return false;
          }
          if (!res.ok && isConversationLost(res.err, { server: targetServer, owningServer })) {
            wasLost = true;
            markConversationLost({ state: fresh, error: res.err, at });
            (fresh.history ??= []).push({
              at,
              op: "nudge",
              round: currentRound,
              ok: false,
              error: res.err,
            });
            return;
          }
          if (res.ok) {
            fresh.nudgedAt = at;
            (fresh.history ??= []).push({
              at,
              op: "nudge",
              round: currentRound,
              ok: true,
              response: res.json ?? res.out,
            });
            nudgeSaved = true;
          } else {
            (fresh.history ??= []).push({
              at,
              op: "nudge",
              round: currentRound,
              ok: false,
              error: res.err,
            });
          }
        },
        { tasksDir },
      );

      if (wasClosed) continue;

      if (wasLost) {
        if (appendMetricFn && loopDir) {
          appendMetricFn(loopDir, {
            event: "conversation_lost",
            taskId: id,
            round: currentRound,
            error: res.err,
          });
        }
        log(id, `conversation lost during nudge: ${res.err}`);
        continue;
      }

      if (nudgeSaved) {
        if (appendMetricFn && loopDir) {
          appendMetricFn(loopDir, {
            event: "nudged",
            taskId: id,
            round: currentRound,
          });
        }
        log(id, `auto-nudge sent for round ${currentRound}`);
      } else {
        log(id, `FAILED to send auto-nudge: ${res.err}`);
      }
    } else if (stallEval.action === "stall") {
      const at = new Date(now).toISOString();
      updateState(
        id,
        (fresh) => {
          if (isTaskClosed(fresh) || fresh.status !== "running") return false;
          log(id, `task stalled: no activity for ${stallEval.stallMinutes}m after nudge`);
          fresh.status = "stalled";
          fresh.stalledAt = at;
          fresh.stalledReason = `No activity for ${stallEval.stallMinutes}m after nudge at ${fresh.nudgedAt}`;
        },
        { tasksDir },
      );
    }
  }
}

export async function refreshMetadata({
  tasksDir = defaultTasksDir(),
  loopDir = defaultLoopDir(),
  agentapi,
  log = console.log,
  appendMetric: appendMetricFn = appendMetric,
  now = Date.now(),
  metadataEveryMs = 60_000,
  metadataState = { lastMetadata: 0 },
} = {}) {
  if (now - metadataState.lastMetadata < metadataEveryMs) return;
  metadataState.lastMetadata = now;
  if (!tasksDir || !fs.existsSync(tasksDir)) return;

  for (const id of fs.readdirSync(tasksDir)) {
    const state = readState(id, { tasksDir });
    if (isTaskClosed(state) || !state.conversationId || state.status !== "running") continue;

    const convId = state.conversationId;
    const isConfig = ownedByConfig(state);
    const targetServer = isConfig ? "config" : "env";
    const owningServer = state.server ?? "config";

    const res = await agentapi(["get-conversation-metadata", convId], { preferConfig: isConfig });
    const at = new Date(now).toISOString();

    let wasLost = false;
    let currentRound = 0;

    updateState(
      id,
      (fresh) => {
        if (isTaskClosed(fresh) || fresh.status !== "running") return false;
        currentRound = fresh.round ?? 0;
        if (!res.ok && isConversationLost(res.err, { server: targetServer, owningServer })) {
          wasLost = true;
          markConversationLost({ state: fresh, error: res.err, at });
          fresh.metadata = res.json ?? res.out;
          fresh.metadataAt = at;
          (fresh.history ??= []).push({ at, op: "metadata", ok: false, error: res.err });
          return;
        }
        fresh.metadata = res.json ?? res.out;
        fresh.metadataAt = at;
      },
      { tasksDir },
    );

    if (wasLost) {
      if (appendMetricFn && loopDir) {
        appendMetricFn(loopDir, {
          event: "conversation_lost",
          taskId: id,
          round: currentRound,
          error: res.err,
        });
      }
      log(id, `conversation lost: ${res.err}`);
    }
  }
}
