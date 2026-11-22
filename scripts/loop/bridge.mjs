#!/usr/bin/env node
/**
 * Engineering loop bridge: Claude Code (orchestrator) → Antigravity (implementer).
 *
 * Run it once from a terminal that Antigravity started (its integrated terminal,
 * or a command an Antigravity agent runs): those carry ANTIGRAVITY_LS_ADDRESS
 * and ANTIGRAVITY_CSRF_TOKEN. Alternatively, .loop/config.json can provide them as fallback.
 *
 *   node scripts/loop/bridge.mjs
 *
 * This file is a thin supervisor: it runs ./bridge-worker.mjs with the same
 * environment and restarts it whenever the worker file changes or it crashes,
 * so fixes to the bridge land without the owner restarting anything.
 */
import { fork } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCredentials } from "./lib/credentials.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "bridge-worker.mjs");
const CONFIG_PATH = path.join(REPO, ".loop", "config.json");

function readLoopConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

let child = null;
let stopping = false;
let restarts = [];

function start() {
  if (child) return;
  child = fork(WORKER, [], { stdio: "inherit" });
  child.on("exit", (code) => {
    child = null;
    if (stopping) return;
    const creds = resolveCredentials(process.env, readLoopConfig());
    if (code === 1 && (!creds.lsAddress || !creds.csrfToken)) process.exit(1); // missing credentials: the worker explained why
    restarts = restarts.filter((t) => Date.now() - t < 60_000);
    restarts.push(Date.now());
    const delay = restarts.length > 5 ? 30_000 : 1_000; // crash loop → back off
    console.log(`[supervisor] worker exited (${code}); restarting in ${delay / 1000}s`);
    setTimeout(start, delay);
  });
}

let reloadTimer = null;
fs.watch(WORKER, () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    console.log("[supervisor] bridge-worker.mjs changed; reloading");
    if (child) child.kill();
    else start();
  }, 500);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopping = true;
    child?.kill();
    process.exit(0);
  });
}

start();
