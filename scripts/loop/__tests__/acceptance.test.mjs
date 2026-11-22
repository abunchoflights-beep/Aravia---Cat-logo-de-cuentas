import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { agentapiEnv, resolveCredentials } from "../lib/credentials.mjs";
import { detectGaming } from "../lib/detector.mjs";
import { checkRoundCap, escalateTask } from "../lib/rounds.mjs";
import { evaluateTaskStall } from "../lib/stall.mjs";
import { buildTaskStatusInfo, formatStatusReport } from "../lib/status.mjs";
import { filterQueueByWip, isTaskRunningWithoutFinalReport } from "../lib/wip.mjs";

describe("Loop Hardening Acceptance Criteria", () => {
  it("Acceptance 1: An in-flight task created before this change still shows correctly and accepts feedback", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-legacy-task-"));
    try {
      const taskDir = path.join(tmpDir, "tasks", "legacy-task");
      fs.mkdirSync(taskDir, { recursive: true });

      // Legacy task.json has NO maxRounds or budgetMinutes
      const legacyTaskJson = {
        taskId: "legacy-task",
        worktree: "/some/worktree",
        branch: "feat/legacy-task",
        base: "feat/platform-v2",
        createdAt: new Date(Date.now() - 30 * 60000).toISOString(),
      };
      fs.writeFileSync(path.join(taskDir, "task.json"), JSON.stringify(legacyTaskJson, null, 2));

      // Legacy state.json
      const legacyStateJson = {
        taskId: "legacy-task",
        conversationId: "conv-legacy-123",
        status: "running",
        round: 0,
        history: [{ op: "new", ok: true }],
      };
      fs.writeFileSync(path.join(taskDir, "state.json"), JSON.stringify(legacyStateJson, null, 2));

      // 1. Reading backward-compatible properties works seamlessly
      const task = JSON.parse(fs.readFileSync(path.join(taskDir, "task.json"), "utf8"));
      const state = JSON.parse(fs.readFileSync(path.join(taskDir, "state.json"), "utf8"));

      const maxRounds = task.maxRounds ?? 3;
      const budgetMinutes = task.budgetMinutes ?? 180;
      expect(maxRounds).toBe(3);
      expect(budgetMinutes).toBe(180);

      // 2. Accepts feedback for round 1
      const nextRound = (state.round ?? 0) + 1;
      const capCheck = checkRoundCap({ round: nextRound, maxRounds });
      expect(capCheck.allowed).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Acceptance 2: With a stale csrfToken in config and a valid one in env, the env one is used", () => {
    const env = {
      ANTIGRAVITY_LS_ADDRESS: "127.0.0.1:55000",
      ANTIGRAVITY_CSRF_TOKEN: "valid-live-csrf-token-from-env",
    };
    const config = {
      lsAddress: "127.0.0.1:44000",
      csrfToken: "stale-token-saved-in-config.json",
    };

    const creds = resolveCredentials(env, config);
    expect(creds.csrfToken).toBe("valid-live-csrf-token-from-env");
    expect(creds.source.csrfToken).toBe("env");
    expect(creds.lsAddress).toBe("127.0.0.1:55000");
    expect(creds.source.lsAddress).toBe("env");

    const runtimeEnv = agentapiEnv(env, config);
    expect(runtimeEnv.ANTIGRAVITY_CSRF_TOKEN).toBe("valid-live-csrf-token-from-env");
  });

  it("Acceptance 3: verify on a worktree with a new .skip( reports it; on a clean worktree reports no findings", () => {
    // Clean diff -> 0 findings
    const cleanDiff = `diff --git a/src/lib/safe.ts b/src/lib/safe.ts
--- a/src/lib/safe.ts
+++ b/src/lib/safe.ts
@@ -1,2 +1,4 @@
 export function safeAdd(a: number, b: number) {
   return a + b;
+}
`;
    const cleanResult = detectGaming(cleanDiff);
    expect(cleanResult.findings).toHaveLength(0);

    // Diff with new .skip( -> reported
    const skipDiff = `diff --git a/src/__tests__/payment.test.ts b/src/__tests__/payment.test.ts
--- a/src/__tests__/payment.test.ts
+++ b/src/__tests__/payment.test.ts
@@ -14,2 +14,3 @@
 describe("payment flow", () => {
+  it.skip("processes credit card charges", async () => {
   });
`;
    const skipResult = detectGaming(skipDiff);
    expect(skipResult.findings).toHaveLength(1);
    expect(skipResult.findings[0]).toEqual(
      expect.objectContaining({
        file: "src/__tests__/payment.test.ts",
        line: 15,
        rule: "test-skip",
        detail: 'it.skip("processes credit card charges", async () => {',
      }),
    );
  });

  it("Acceptance 4: 4th feedback on a maxRounds: 3 task is refused and the task shows escalated", () => {
    const maxRounds = 3;
    const state = {
      taskId: "task-flaky",
      status: "running",
      round: 0,
    };

    // Rounds 1, 2, 3 allowed
    for (let r = 1; r <= 3; r++) {
      const check = checkRoundCap({ round: r, maxRounds });
      expect(check.allowed).toBe(true);
      state.round = r;
    }

    // 4th feedback
    const fourthRound = state.round + 1; // 4
    const fourthCheck = checkRoundCap({ round: fourthRound, maxRounds });
    expect(fourthCheck.allowed).toBe(false);

    // Escalates task
    const { escalated, message } = escalateTask({
      taskId: "task-flaky",
      round: fourthRound,
      maxRounds,
      state,
    });

    expect(escalated).toBe(true);
    expect(state.status).toBe("escalated");
    expect(state.escalationReason).toContain("4 > 3 rounds");
    expect(message).toContain("task-flaky");
  });

  it("Acceptance 5: With maxParallel: 1 and two queued new jobs, the second waits until the first has a final report", () => {
    const queue = [
      { op: "new", taskId: "task-job-1", round: 0 },
      { op: "new", taskId: "task-job-2", round: 0 },
    ];

    // State 1: 0 running tasks. First job can start, second job blocked.
    const step1 = filterQueueByWip(queue, 0, 1);
    expect(step1.runnable).toHaveLength(1);
    expect(step1.runnable[0].taskId).toBe("task-job-1");
    expect(step1.blocked).toHaveLength(1);
    expect(step1.blocked[0].taskId).toBe("task-job-2");

    // State 2: Task 1 is dispatched and running without report.
    const task1State = { taskId: "task-job-1", status: "running" };
    expect(isTaskRunningWithoutFinalReport(task1State, null)).toBe(true);

    const step2 = filterQueueByWip([queue[1]], 1, 1); // 1 running task
    expect(step2.runnable).toHaveLength(0); // Task 2 must wait
    expect(step2.blocked).toHaveLength(1);

    // State 3: Task 1 writes a report with LOOP-STATUS: ready-for-review
    expect(isTaskRunningWithoutFinalReport(task1State, "ready-for-review")).toBe(false);

    // Now active running count without final report is 0. Task 2 can now run!
    const step3 = filterQueueByWip([queue[1]], 0, 1);
    expect(step3.runnable).toHaveLength(1);
    expect(step3.runnable[0].taskId).toBe("task-job-2");
    expect(step3.blocked).toHaveLength(0);
  });

  it("Acceptance 6: A task idle for stallMinutes is nudged; if still idle for stallMinutes after nudge, becomes stalled", () => {
    const t0 = 1000000;
    const state = {
      taskId: "stall-accept",
      status: "running",
      round: 0,
      roundStartedAt: new Date(t0).toISOString(),
    };

    // 1. Inactive for 30m -> nudge action
    const res1 = evaluateTaskStall({
      taskId: "stall-accept",
      state,
      config: { stallMinutes: 30 },
      now: t0 + 30 * 60_000,
      mtimeTracker: { getLatestMtime: () => t0, clear: () => {} },
      getCommitTime: () => t0,
    });
    expect(res1.action).toBe("nudge");

    // 2. Nudge recorded
    state.nudgedAt = new Date(t0 + 30 * 60_000).toISOString();

    // 3. 15m after nudge (still no activity) -> waiting (none)
    const res2 = evaluateTaskStall({
      taskId: "stall-accept",
      state,
      config: { stallMinutes: 30 },
      now: t0 + 45 * 60_000,
      mtimeTracker: { getLatestMtime: () => t0, clear: () => {} },
      getCommitTime: () => t0,
    });
    expect(res2.action).toBe("none");

    // 4. 30m after nudge (total 60m, still no activity) -> stall action
    const res3 = evaluateTaskStall({
      taskId: "stall-accept",
      state,
      config: { stallMinutes: 30 },
      now: t0 + 60 * 60_000,
      mtimeTracker: { getLatestMtime: () => t0, clear: () => {} },
      getCommitTime: () => t0,
    });
    expect(res3.action).toBe("stall");
  });

  it("Acceptance 7: Closed tasks never display budget or OVER BUDGET, and are listed compactly by default", () => {
    const openTask = buildTaskStatusInfo({
      taskId: "open-t",
      taskDir: "/none",
      task: { createdAt: new Date(Date.now() - 300 * 60000).toISOString(), budgetMinutes: 60 },
      state: { status: "running", round: 0 },
    });
    expect(openTask.budgetStr).toContain("(OVER BUDGET)");

    const mergedTask = buildTaskStatusInfo({
      taskId: "closed-t",
      taskDir: "/none",
      task: { createdAt: new Date(Date.now() - 300 * 60000).toISOString(), budgetMinutes: 60 },
      state: { status: "merged", round: 0 },
    });
    expect(mergedTask.budgetStr).toBe("");

    const reportCompact = formatStatusReport({
      tasks: [openTask, mergedTask],
      all: false,
    });
    expect(reportCompact).toContain("Closed tasks (1, use --all to show details):");
    expect(reportCompact).toContain("  - closed-t                 [merged] round 0");

    const reportAll = formatStatusReport({
      tasks: [openTask, mergedTask],
      all: true,
    });
    expect(reportAll).not.toContain("use --all to show details");
    expect(reportAll).toContain("closed-t  [merged] round 0");
    expect(reportAll).not.toContain(
      "closed-t  [merged] round 0\n  branch ?  conversation -\n  budget:",
    );
  });
});
