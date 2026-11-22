#!/usr/bin/env node
/**
 * Engineering loop bridge worker: Claude Code (orchestrator) → Antigravity (implementer).
 * Started and restarted by ./bridge.mjs (the supervisor); don't run it directly.
 *
 * Credentials rule: Fresh credentials win.
 * ANTIGRAVITY_LS_ADDRESS and ANTIGRAVITY_CSRF_TOKEN from the environment take precedence;
 * .loop/config.json values are fallback only. Values are never printed or logged.
 *
 * It watches .loop/queue/*.json (written by scripts/loop/loop.mjs), turns each
 * into an `agentapi new-conversation` / `send-message` call, records the
 * conversation in .loop/tasks/<id>/state.json, enforces maxParallel WIP limits,
 * monitors time budgets per round, and keeps a heartbeat in .loop/bridge.json.
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkActiveTasksBudgetAndReports as checkActiveTasksBudgetAndReportsLib,
  checkActiveTasksStall as checkActiveTasksStallLib,
  countRunningTasksWithoutFinalReport as countRunningTasksWithoutFinalReportLib,
  handleJob,
  refreshMetadata as refreshMetadataLib,
} from "./lib/bridge-passes.mjs";
import { agentapiEnv, resolveCredentials } from "./lib/credentials.mjs";
import { appendMetric } from "./lib/metrics.mjs";
import { createMtimeTracker } from "./lib/stall.mjs";
import { DEFAULT_MAX_PARALLEL } from "./lib/wip.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOOP = process.env.LOOP_DIR ? path.resolve(process.env.LOOP_DIR) : path.join(REPO, ".loop");
const QUEUE = path.join(LOOP, "queue");
const DONE = path.join(QUEUE, "done");
const TASKS = path.join(LOOP, "tasks");
const POLL_MS = 2000;
const CONFIG_PATH = path.join(LOOP, "config.json");
const METADATA_EVERY_MS = 60_000;
const mtimeTracker = createMtimeTracker();

for (const dir of [QUEUE, DONE, TASKS]) fs.mkdirSync(dir, { recursive: true });

function readLoopConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

const startupCreds = resolveCredentials(process.env, readLoopConfig());
if (!startupCreds.lsAddress || !startupCreds.csrfToken) {
  console.error(
    [
      "ANTIGRAVITY_LS_ADDRESS / ANTIGRAVITY_CSRF_TOKEN are not set in this terminal and not in .loop/config.json.",
      "Start the bridge from a terminal Antigravity created, e.g. ask an Antigravity agent:",
      '  "Run `node scripts/loop/bridge.mjs` in the background and leave it running."',
    ].join("\n"),
  );
  process.exit(1);
}

function agentapiCommand() {
  const config = readLoopConfig();
  const override = config.agentapiExe || process.env.ANTIGRAVITY_AGENTAPI_EXE;
  if (override && fs.existsSync(override)) {
    const isScript = /\.(bat|cmd)$/i.test(override) || /agentapi/i.test(path.basename(override));
    return { file: override, pre: isScript ? [] : ["agentapi"] };
  }
  const ls = path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
    "Programs",
    "Antigravity IDE",
    "resources",
    "app",
    "extensions",
    "antigravity",
    "bin",
    "language_server_windows_x64.exe",
  );
  if (fs.existsSync(ls)) return { file: ls, pre: ["agentapi"] };
  const bat = path.join(os.homedir(), ".gemini", "antigravity-ide", "bin", "agentapi.bat");
  return { file: bat, pre: [] };
}

function agentapi(args, { preferConfig = false } = {}) {
  const { file, pre } = agentapiCommand();
  const all = [...pre, ...args];
  const config = readLoopConfig();
  const env = preferConfig ? agentapiEnv({}, config) : agentapiEnv(process.env, config);

  return new Promise((resolve) => {
    const done = (err, stdout, stderr) => {
      const out = String(stdout ?? "").trim();
      let json = null;
      try {
        json = JSON.parse(out);
      } catch {
        /* not JSON */
      }
      const ok = !err && !json?.error;
      const detail = [
        json?.error,
        err?.message,
        out && !json ? `stdout: ${out.slice(0, 500)}` : null,
        String(stderr ?? "")
          .trim()
          .slice(-500),
      ]
        .filter(Boolean)
        .join(" | ");
      resolve({ ok, json, out, err: ok ? undefined : detail || "unknown error" });
    };
    if (/\.(bat|cmd)$/i.test(file)) {
      const child = spawn(
        file,
        all.map((a) => (/\s/.test(a) ? `"${a}"` : a)),
        { shell: true, env },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => done(code ? new Error(`exit ${code}`) : null, stdout, stderr));
    } else {
      execFile(file, all, { maxBuffer: 10 * 1024 * 1024, timeout: 120_000, env }, done);
    }
  });
}

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

async function handle(job) {
  return handleJob(job, {
    tasksDir: TASKS,
    loopDir: LOOP,
    agentapi,
    log,
    mtimeTracker,
    appendMetric,
  });
}

async function pollQueue() {
  const config = readLoopConfig();
  const maxParallel = Number(config.maxParallel ?? DEFAULT_MAX_PARALLEL);

  const files = fs
    .readdirSync(QUEUE)
    .filter((f) => f.endsWith(".json"))
    .sort();

  for (const f of files) {
    const src = path.join(QUEUE, f);
    let job;
    try {
      job = JSON.parse(fs.readFileSync(src, "utf8"));
    } catch (e) {
      log(`bad job ${f}: ${e.message}`);
      fs.renameSync(src, path.join(DONE, `${f}.bad`));
      continue;
    }

    // Check WIP limit on "new" and "resume" jobs
    if (job.op === "new" || job.op === "resume") {
      const runningCount = countRunningTasksWithoutFinalReportLib({ tasksDir: TASKS });
      if (runningCount >= maxParallel) {
        // WIP limit reached. Keep in queue (FIFO).
        continue;
      }
    }

    fs.renameSync(src, path.join(DONE, f));
    await handle(job);
  }
}

const metadataState = { lastMetadata: 0 };
async function refreshMetadata() {
  return refreshMetadataLib({
    tasksDir: TASKS,
    loopDir: LOOP,
    agentapi,
    log,
    appendMetric,
    metadataEveryMs: METADATA_EVERY_MS,
    metadataState,
  });
}

function checkActiveTasksBudgetAndReports() {
  return checkActiveTasksBudgetAndReportsLib({
    tasksDir: TASKS,
    loopDir: LOOP,
    log,
    appendMetric,
  });
}

async function checkActiveTasksStall() {
  return checkActiveTasksStallLib({
    tasksDir: TASKS,
    loopDir: LOOP,
    agentapi,
    log,
    mtimeTracker,
    appendMetric,
  });
}

function heartbeat() {
  const creds = resolveCredentials(process.env, readLoopConfig());
  const envForAgentapi = agentapiEnv(process.env, readLoopConfig());

  fs.writeFileSync(
    path.join(LOOP, "bridge.json"),
    JSON.stringify(
      {
        pid: process.pid,
        startedAt,
        beatAt: new Date().toISOString(),
        agentapi: agentapiCommand(),
        credentialsSource: creds.source,
        antigravityEnv: Object.keys(process.env)
          .filter((k) => k.startsWith("ANTIGRAVITY_"))
          .sort(),
        projectId: envForAgentapi.ANTIGRAVITY_PROJECT_ID ?? null,
      },
      null,
      2,
    ),
  );
}

const startedAt = new Date().toISOString();
log(`bridge up (pid ${process.pid}), watching ${QUEUE}`);
let busy = false;
setInterval(async () => {
  heartbeat();
  if (busy) return;
  busy = true;
  try {
    await pollQueue();
    checkActiveTasksBudgetAndReports();
    await checkActiveTasksStall();
    await refreshMetadata();
  } catch (e) {
    log(`loop error: ${e.message}`);
  } finally {
    busy = false;
  }
}, POLL_MS);
heartbeat();
