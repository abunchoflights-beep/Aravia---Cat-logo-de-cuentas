import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  checkBudget,
  checkRoundCap,
  checkWaitStatus,
  closeTask,
  DEFAULT_BUDGET_MINUTES,
  DEFAULT_MAX_ROUNDS,
  escalateTask,
  getExpectedRound,
  getHighestFeedbackRound,
  getLatestReport,
} from "../lib/rounds.mjs";

describe("round cap and escalation", () => {
  it("enforces default max rounds of 3", () => {
    expect(checkRoundCap({ round: 1 })).toEqual({
      allowed: true,
      round: 1,
      maxRounds: DEFAULT_MAX_ROUNDS,
    });
    expect(checkRoundCap({ round: 2 })).toEqual({
      allowed: true,
      round: 2,
      maxRounds: DEFAULT_MAX_ROUNDS,
    });
    expect(checkRoundCap({ round: 3 })).toEqual({
      allowed: true,
      round: 3,
      maxRounds: DEFAULT_MAX_ROUNDS,
    });
    expect(checkRoundCap({ round: 4 })).toEqual({
      allowed: false,
      round: 4,
      maxRounds: DEFAULT_MAX_ROUNDS,
    });
  });

  it("honors custom maxRounds", () => {
    expect(checkRoundCap({ round: 5, maxRounds: 5 }).allowed).toBe(true);
    expect(checkRoundCap({ round: 6, maxRounds: 5 }).allowed).toBe(false);
  });

  it("escalates task with message for human owner", () => {
    const state = { taskId: "sample-task", status: "running", round: 3 };
    const { escalated, message } = escalateTask({
      taskId: "sample-task",
      round: 4,
      maxRounds: 3,
      state,
    });

    expect(escalated).toBe(true);
    expect(state.status).toBe("escalated");
    expect(state.escalatedAt).toBeDefined();
    expect(state.escalationReason).toContain("4 > 3 rounds");
    expect(message).toContain("[ESCALATED]");
    expect(message).toContain("sample-task");
  });
});

describe("time budget per round", () => {
  it("measures elapsed time from startedAt (current round start)", () => {
    const now = Date.now();
    const taskCreatedAt = new Date(now - 300 * 60_000).toISOString(); // 5 hours ago overall
    const roundStartedAt = new Date(now - 45 * 60_000).toISOString(); // 45m ago for this round

    // Budget check uses round start: 45m elapsed out of 180m budget, not over budget!
    const res = checkBudget({
      startedAt: roundStartedAt,
      createdAt: taskCreatedAt,
      budgetMinutes: 180,
      now,
    });
    expect(res.elapsedMinutes).toBe(45);
    expect(res.budgetMinutes).toBe(180);
    expect(res.remainingMinutes).toBe(135);
    expect(res.overBudget).toBe(false);
  });

  it("flags round that exceeds its time budget", () => {
    const now = Date.now();
    const roundStartedAt = new Date(now - 195 * 60_000).toISOString(); // 195m into this round

    const res = checkBudget({ startedAt: roundStartedAt, budgetMinutes: 180, now });
    expect(res.elapsedMinutes).toBe(195);
    expect(res.overBudget).toBe(true);
    expect(res.remainingMinutes).toBe(0);
  });

  it("falls back to createdAt when startedAt is absent (old tasks)", () => {
    const now = Date.now();
    const createdAt = new Date(now - 30 * 60_000).toISOString();

    const res = checkBudget({ createdAt, now });
    expect(res.elapsedMinutes).toBe(30);
    expect(res.budgetMinutes).toBe(DEFAULT_BUDGET_MINUTES);
    expect(res.overBudget).toBe(false);
  });
});

describe("feedback and wait race condition prevention", () => {
  it("detects highest feedback round on disk", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-fb-round-"));
    try {
      expect(getHighestFeedbackRound(tmpDir)).toBe(0);

      fs.writeFileSync(path.join(tmpDir, "feedback-1.md"), "round 1");
      expect(getHighestFeedbackRound(tmpDir)).toBe(1);

      fs.writeFileSync(path.join(tmpDir, "feedback-2.md"), "round 2");
      expect(getHighestFeedbackRound(tmpDir)).toBe(2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("waits for new round when feedback is written but state is still at round 0 with final report-0", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-race-test-"));
    try {
      // Setup: round 0 has finished and written a final report
      fs.writeFileSync(
        path.join(tmpDir, "report-0.md"),
        "# Report 0\nAll gates pass.\n\nLOOP-STATUS: ready-for-review\n",
      );

      // Orchestrator sends feedback: writes feedback-1.md
      fs.writeFileSync(path.join(tmpDir, "feedback-1.md"), "# Feedback round 1");

      // Bridge has not processed it yet, so state.round is still 0
      const state = { taskId: "test-race", round: 0, status: "running" };

      // Expected round must be 1, NOT 0!
      const expectedRound = getExpectedRound(state, tmpDir);
      expect(expectedRound).toBe(1);

      // Latest report check for expected round 1 must return null status (not ready-for-review!)
      const latest = getLatestReport(tmpDir, expectedRound);
      expect(latest.round).toBe(1);
      expect(latest.status).toBeNull(); // wait keeps waiting!

      // Delivery indicator: expectedRound (1) > state.round (0)
      const isDelivering = expectedRound > (state.round ?? 0);
      expect(isDelivering).toBe(true);

      // Once the agent finishes round 1 and writes report-1.md:
      fs.writeFileSync(
        path.join(tmpDir, "report-1.md"),
        "# Report 1\nFixed everything.\n\nLOOP-STATUS: ready-for-review\n",
      );

      // Bridge updates state.round to 1
      state.round = 1;
      expect(getExpectedRound(state, tmpDir)).toBe(1);
      expect(getLatestReport(tmpDir, 1).status).toBe("ready-for-review");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("task close", () => {
  it("marks task as merged", () => {
    const state = { taskId: "task-1", status: "running" };
    closeTask({ taskId: "task-1", outcome: "merged", state });
    expect(state.status).toBe("merged");
    expect(state.closedAt).toBeDefined();
    expect(state.closeReason).toBe("merged");
  });

  it("marks task as abandoned", () => {
    const state = { taskId: "task-2", status: "running" };
    closeTask({ taskId: "task-2", outcome: "abandoned", state });
    expect(state.status).toBe("abandoned");
    expect(state.closedAt).toBeDefined();
    expect(state.closeReason).toBe("abandoned");
  });

  it("rejects invalid close outcome", () => {
    const state = { taskId: "task-3", status: "running" };
    expect(() => closeTask({ taskId: "task-3", outcome: "cancelled", state })).toThrow();
  });
});

describe("checkWaitStatus", () => {
  it("exits with exit_error on stalled status", () => {
    const state = {
      status: "stalled",
      stalledReason: "no activity for 30m after nudge",
    };
    const res = checkWaitStatus({ state, report: { status: null }, isDelivering: false });
    expect(res.action).toBe("exit_error");
    expect(res.status).toBe("stalled");
    expect(res.reason).toContain("no activity for 30m after nudge");
  });
});
