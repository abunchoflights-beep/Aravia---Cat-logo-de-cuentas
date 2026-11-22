import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  appendMetric,
  computeMetricsSummary,
  formatDuration,
  formatMetricsReport,
  readMetrics,
} from "../lib/metrics.mjs";

describe("metrics tracking and aggregation", () => {
  it("formats durations cleanly", () => {
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(120 * 60_000)).toBe("2h");
    expect(formatDuration(135 * 60_000)).toBe("2h 15m");
  });

  it("appends and reads metrics events", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-metrics-test-"));
    try {
      appendMetric(tmpDir, { event: "dispatched", taskId: "test-task", model: "pro" });
      appendMetric(tmpDir, {
        event: "verify",
        taskId: "test-task",
        round: 0,
        passed: true,
        findingsCount: 0,
      });
      appendMetric(tmpDir, { event: "nudged", taskId: "test-task", round: 0 });

      const events = readMetrics(tmpDir);
      expect(events).toHaveLength(3);
      expect(events[0].event).toBe("dispatched");
      expect(events[0].taskId).toBe("test-task");
      expect(events[0].timestamp).toBeDefined();
      expect(events[1].event).toBe("verify");
      expect(events[1].passed).toBe(true);
      expect(events[2].event).toBe("nudged");
      expect(events[2].taskId).toBe("test-task");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("aggregates per-task stats and overall totals", () => {
    const baseTime = 1700000000000;
    const events = [
      // Task 1: 2 rounds, first verify passed, merged
      { event: "dispatched", taskId: "task-1", timestamp: new Date(baseTime).toISOString() },
      {
        event: "verify",
        taskId: "task-1",
        round: 0,
        passed: true,
        findingsCount: 0,
        timestamp: new Date(baseTime + 30 * 60000).toISOString(),
      },
      {
        event: "feedback",
        taskId: "task-1",
        round: 1,
        timestamp: new Date(baseTime + 35 * 60000).toISOString(),
      },
      {
        event: "verify",
        taskId: "task-1",
        round: 1,
        passed: true,
        findingsCount: 0,
        timestamp: new Date(baseTime + 60 * 60000).toISOString(),
      },
      {
        event: "closed",
        taskId: "task-1",
        result: "merged",
        timestamp: new Date(baseTime + 65 * 60000).toISOString(),
      },

      // Task 2: 1 round, first verify failed, abandoned
      {
        event: "dispatched",
        taskId: "task-2",
        timestamp: new Date(baseTime + 10 * 60000).toISOString(),
      },
      {
        event: "verify",
        taskId: "task-2",
        round: 0,
        passed: false,
        findingsCount: 2,
        timestamp: new Date(baseTime + 40 * 60000).toISOString(),
      },
      {
        event: "closed",
        taskId: "task-2",
        result: "abandoned",
        timestamp: new Date(baseTime + 45 * 60000).toISOString(),
      },

      // Task 3: in progress, no verify yet
      {
        event: "dispatched",
        taskId: "task-3",
        timestamp: new Date(baseTime + 20 * 60000).toISOString(),
      },

      // Task 4: merged in round 0 without feedback
      {
        event: "dispatched",
        taskId: "task-4",
        timestamp: new Date(baseTime + 25 * 60000).toISOString(),
      },
      {
        event: "verify",
        taskId: "task-4",
        round: 0,
        passed: true,
        findingsCount: 0,
        timestamp: new Date(baseTime + 50 * 60000).toISOString(),
      },
      {
        event: "closed",
        taskId: "task-4",
        result: "merged",
        timestamp: new Date(baseTime + 55 * 60000).toISOString(),
      },
    ];

    const summary = computeMetricsSummary(events);
    expect(summary.tasks).toHaveLength(4);

    const t1 = summary.tasks.find((t) => t.taskId === "task-1");
    expect(t1.rounds).toBe(1); // highest feedback round
    expect(t1.firstPassVerify).toBe("passed");
    expect(t1.status).toBe("merged");
    expect(t1.wallTimeString).toBe("1h 5m");

    const t2 = summary.tasks.find((t) => t.taskId === "task-2");
    expect(t2.firstPassVerify).toBe("failed");
    expect(t2.status).toBe("abandoned");

    const t3 = summary.tasks.find((t) => t.taskId === "task-3");
    expect(t3.firstPassVerify).toBe("none");

    const t4 = summary.tasks.find((t) => t.taskId === "task-4");
    expect(t4.rounds).toBe(0);
    expect(t4.firstPassVerify).toBe("passed");
    expect(t4.status).toBe("merged");

    // Totals
    // Tasks with verify: 3 (task-1 passed, task-2 failed, task-4 passed) -> 66.7% (2/3)
    expect(summary.totals.totalTasks).toBe(4);
    expect(summary.totals.firstPassTotalCount).toBe(3);
    expect(summary.totals.firstPassPassCount).toBe(2);
    expect(summary.totals.firstVerifyPassed).toBe("66.7% (2/3)");
    expect(summary.totals.firstPassAcceptanceRate).toBe("66.7% (2/3)");
    expect(summary.totals.tasksMerged).toBe(2);
    // Tasks merged in round 0 without feedback: task-4 (1 out of 2 merged) -> 50.0% (1/2)
    expect(summary.totals.mergedWithoutFeedbackCount).toBe(1);
    expect(summary.totals.mergedWithoutFeedback).toBe("50.0% (1/2)");

    const report = formatMetricsReport(summary);
    expect(report).toContain("task-1");
    expect(report).toContain("task-2");
    expect(report).toContain("task-4");
    expect(report).toContain("First verify passed:         66.7% (2/3)");
    expect(report).toContain("Merged without feedback:     50.0% (1/2)");
    expect(report).toContain("Tasks merged:                2");
  });
});
