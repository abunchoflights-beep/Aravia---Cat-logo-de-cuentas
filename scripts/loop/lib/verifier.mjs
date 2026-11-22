/**
 * Verifier and gate execution for the engineering loop.
 *
 * Runs in task's worktree:
 * 1. vp check (Oxfmt, Oxlint type-aware + typeCheck)
 * 2. vp run -r test (workspace unit tests)
 * 3. vp -C api run test:e2e (API e2e tests)
 * 4. vp run -r build (if --build is provided)
 *
 * Runs gaming detector (diff vs base + uncommitted changes).
 * Writes .loop/tasks/<id>/verify-<round>.json (per gate: pass/fail, duration, last 40 lines of output).
 * Appends verify event to .loop/metrics.jsonl.
 * Returns { passed, gates, findings, verifyFile }.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { scanWorktreeGaming } from "./detector.mjs";
import { appendMetric } from "./metrics.mjs";

/**
 * Runs a single gate command in the worktree directory.
 *
 * @param {string} name
 * @param {string} cmd
 * @param {string} cwd
 * @returns {Promise<{
 *   name: string,
 *   cmd: string,
 *   passed: boolean,
 *   durationMs: number,
 *   output: string
 * }>}
 */
export function runGate(name, cmd, cwd) {
  return new Promise((resolve) => {
    const start = Date.now();
    let combined = "";

    const child = spawn(cmd, {
      cwd,
      shell: true,
      env: { ...process.env, CI: "true" },
    });

    child.stdout?.on("data", (d) => (combined += d));
    child.stderr?.on("data", (d) => (combined += d));

    child.on("close", (code) => {
      const durationMs = Date.now() - start;
      const lines = combined.split(/\r?\n/);
      const last40 = lines.slice(-40).join("\n");
      resolve({
        name,
        cmd,
        passed: code === 0,
        durationMs,
        output: last40,
        fullOutput: combined,
      });
    });
  });
}

/**
 * Executes all gates and the gaming detector for a task.
 *
 * @param {{
 *   taskId: string,
 *   worktree: string,
 *   base?: string,
 *   round?: number,
 *   build?: boolean,
 *   loopDir: string
 * }} options
 * @returns {Promise<{
 *   passed: boolean,
 *   gates: Array<{ name: string, cmd: string, passed: boolean, durationMs: number, output: string }>,
 *   findings: Array<{ file: string, line: number, rule: string, detail?: string }>,
 *   verifyFile: string
 * }>}
 */
export async function runVerify({
  taskId,
  worktree,
  base = "main",
  round = 0,
  build = false,
  loopDir,
}) {
  const gateConfigs = [
    { name: "check", cmd: "vp check" },
    { name: "test", cmd: "vp run -r test" },
    { name: "e2e", cmd: "vp -C api run test:e2e" },
  ];

  if (build) {
    gateConfigs.push({ name: "build", cmd: "vp run -r build" });
  }

  const gates = [];
  let testGateOutput = "";

  for (const gc of gateConfigs) {
    console.log(`[verify] Running ${gc.name}: ${gc.cmd}...`);
    const res = await runGate(gc.name, gc.cmd, worktree);
    gates.push({
      name: res.name,
      cmd: res.cmd,
      passed: res.passed,
      durationMs: res.durationMs,
      output: res.output,
    });
    if (res.name === "test") {
      testGateOutput = res.fullOutput || res.output;
    }
  }

  // Run gaming detector
  console.log(`[verify] Running gaming detector against ${base}...`);
  const { findings } = scanWorktreeGaming(worktree, base, { vitestOutput: testGateOutput });

  const passed = gates.every((g) => g.passed);

  const taskDir = path.join(loopDir, "tasks", taskId);
  fs.mkdirSync(taskDir, { recursive: true });
  const verifyFile = path.join(taskDir, `verify-${round}.json`);

  const payload = {
    taskId,
    round,
    timestamp: new Date().toISOString(),
    passed,
    gates,
    findings,
  };

  fs.writeFileSync(verifyFile, JSON.stringify(payload, null, 2), "utf8");

  // Record verify event in metrics
  appendMetric(loopDir, {
    event: "verify",
    taskId,
    round,
    passed,
    findingsCount: findings.length,
  });

  return { passed, gates, findings, verifyFile };
}

/**
 * Formats a one-screen summary of the verify run.
 *
 * @param {{
 *   taskId: string,
 *   round: number,
 *   passed: boolean,
 *   gates: Array<{ name: string, passed: boolean, durationMs: number }>,
 *   findings: Array<{ file: string, line: number, rule: string, detail?: string }>
 * }} result
 * @returns {string}
 */
export function formatVerifySummary({ taskId, round, passed, gates, findings }) {
  const lines = [];
  lines.push(`\n=== Verify Summary: ${taskId} (Round ${round}) ===`);
  lines.push(`Result: ${passed ? "PASSED" : "FAILED"}\n`);

  lines.push("Gates:");
  for (const g of gates) {
    const status = g.passed ? "PASS" : "FAIL";
    const dur = `${(g.durationMs / 1000).toFixed(1)}s`;
    lines.push(`  [${status.padEnd(4)}] ${g.name.padEnd(8)} (${dur})`);
  }

  lines.push(`\nGaming detector findings: ${findings.length}`);
  if (findings.length > 0) {
    for (const f of findings) {
      lines.push(`  - ${f.file}:${f.line} [${f.rule}]${f.detail ? ` - ${f.detail}` : ""}`);
    }
  }

  return lines.join("\n");
}
