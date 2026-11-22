import { describe, expect, it } from "vite-plus/test";
import {
  canDispatchNewJob,
  filterQueueByWip,
  isTaskRunningWithoutFinalReport,
} from "../lib/wip.mjs";

describe("WIP limit and queue filtering", () => {
  it("determines whether a task is running without a final report", () => {
    // Running without report
    expect(isTaskRunningWithoutFinalReport({ status: "running" }, null)).toBe(true);
    expect(isTaskRunningWithoutFinalReport({ status: "running" }, "writing")).toBe(true);

    // Running with final report
    expect(isTaskRunningWithoutFinalReport({ status: "running" }, "ready-for-review")).toBe(false);
    expect(isTaskRunningWithoutFinalReport({ status: "running" }, "blocked")).toBe(false);

    // Not running
    expect(isTaskRunningWithoutFinalReport({ status: "merged" }, null)).toBe(false);
    expect(isTaskRunningWithoutFinalReport({ status: "abandoned" }, null)).toBe(false);
    expect(isTaskRunningWithoutFinalReport({ status: "escalated" }, null)).toBe(false);
    expect(isTaskRunningWithoutFinalReport({ status: "dispatch_failed" }, null)).toBe(false);
  });

  it("checks canDispatchNewJob limit", () => {
    expect(canDispatchNewJob(0, 3)).toBe(true);
    expect(canDispatchNewJob(2, 3)).toBe(true);
    expect(canDispatchNewJob(3, 3)).toBe(false);
    expect(canDispatchNewJob(4, 3)).toBe(false);
  });

  it("enforces FIFO queueing with maxParallel: 1 (acceptance test)", () => {
    // Two new jobs in queue; 0 currently running tasks.
    const queue = [
      { op: "new", taskId: "task-alpha", round: 0 },
      { op: "new", taskId: "task-beta", round: 0 },
    ];

    const { runnable, blocked } = filterQueueByWip(queue, 0, 1);
    expect(runnable).toHaveLength(1);
    expect(runnable[0].taskId).toBe("task-alpha");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].taskId).toBe("task-beta");
  });

  it("blocks all new jobs when running tasks equal or exceed maxParallel", () => {
    const queue = [
      { op: "new", taskId: "task-1", round: 0 },
      { op: "new", taskId: "task-2", round: 0 },
    ];

    // Already 1 task running without report, and maxParallel is 1
    const { runnable, blocked } = filterQueueByWip(queue, 1, 1);
    expect(runnable).toHaveLength(0);
    expect(blocked).toHaveLength(2);
  });

  it("allows feedback (send) jobs even when WIP limit is reached", () => {
    const queue = [
      { op: "send", taskId: "active-task-1", round: 1 },
      { op: "new", taskId: "task-incoming", round: 0 },
    ];

    // Running count is at maxParallel (1)
    const { runnable, blocked } = filterQueueByWip(queue, 1, 1);
    expect(runnable).toHaveLength(1);
    expect(runnable[0].taskId).toBe("active-task-1");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].taskId).toBe("task-incoming");
  });
});
