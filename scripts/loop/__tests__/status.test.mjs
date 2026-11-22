import { describe, expect, it } from "vite-plus/test";
import {
  buildTaskStatusInfo,
  formatClosedTaskCompact,
  formatStatusReport,
  formatTaskDetail,
} from "../lib/status.mjs";

describe("status display and filtering", () => {
  const now = 1700000000000;
  const twoHoursAgo = new Date(now - 120 * 60_000).toISOString();
  const fourHoursAgo = new Date(now - 240 * 60_000).toISOString();

  it("shows budget and OVER BUDGET only for open tasks, never for closed tasks", () => {
    // 1. Open task that is over budget (240m > 180m)
    const openTask = buildTaskStatusInfo({
      taskId: "task-open-over",
      taskDir: "/nonexistent",
      task: { createdAt: fourHoursAgo, budgetMinutes: 180 },
      state: { status: "running", round: 0, roundStartedAt: fourHoursAgo },
      now,
    });

    expect(openTask.isClosed).toBe(false);
    expect(openTask.isOverBudget).toBe(true);
    expect(openTask.budgetStr).toContain("240m / 180m (round)");
    expect(openTask.budgetStr).toContain("(OVER BUDGET)");

    // 2. Merged task (closed): even though elapsed is 240m, budgetStr must be empty!
    const mergedTask = buildTaskStatusInfo({
      taskId: "task-merged",
      taskDir: "/nonexistent",
      task: { createdAt: fourHoursAgo, budgetMinutes: 180 },
      state: { status: "merged", round: 0, roundStartedAt: fourHoursAgo },
      now,
    });

    expect(mergedTask.isClosed).toBe(true);
    expect(mergedTask.budgetStr).toBe("");

    // 3. Abandoned task (closed): budgetStr must be empty!
    const abandonedTask = buildTaskStatusInfo({
      taskId: "task-abandoned",
      taskDir: "/nonexistent",
      task: { createdAt: fourHoursAgo, budgetMinutes: 180 },
      state: { status: "abandoned", round: 1, roundStartedAt: fourHoursAgo },
      now,
    });

    expect(abandonedTask.isClosed).toBe(true);
    expect(abandonedTask.budgetStr).toBe("");

    // Format detail check
    const mergedDetail = formatTaskDetail(mergedTask);
    expect(mergedDetail).not.toContain("budget:");
    expect(mergedDetail).not.toContain("OVER BUDGET");
  });

  it("displays stalled tasks prominently with a STALLED banner", () => {
    const stalledTask = buildTaskStatusInfo({
      taskId: "task-stalled",
      taskDir: "/nonexistent",
      task: { createdAt: twoHoursAgo, budgetMinutes: 180 },
      state: {
        status: "stalled",
        round: 0,
        stalledReason: "no activity for 30m after nudge",
      },
      now,
    });

    expect(stalledTask.displayStatus).toBe("stalled");
    expect(stalledTask.stalledBanner).toContain("*** STALLED ***");
    expect(stalledTask.stalledBanner).toContain("no activity for 30m after nudge");
    expect(stalledTask.stalledBanner).toContain(
      "Resume with: node scripts/loop/loop.mjs resume task-stalled",
    );

    const detail = formatTaskDetail(stalledTask);
    expect(detail).toContain("[stalled]");
    expect(detail).toContain("*** STALLED ***");
  });

  it("lists closed tasks compactly at the end by default (all: false)", () => {
    const openTask = buildTaskStatusInfo({
      taskId: "task-active",
      taskDir: "/nonexistent",
      task: { createdAt: twoHoursAgo, budgetMinutes: 180 },
      state: { status: "running", round: 0 },
      now,
    });

    const mergedTask = buildTaskStatusInfo({
      taskId: "task-done",
      taskDir: "/nonexistent",
      task: { createdAt: fourHoursAgo },
      state: { status: "merged", round: 0 },
      now,
    });

    const abandonedTask = buildTaskStatusInfo({
      taskId: "task-dropped",
      taskDir: "/nonexistent",
      task: { createdAt: fourHoursAgo },
      state: { status: "abandoned", round: 1 },
      now,
    });

    const output = formatStatusReport({
      bridgeHealthText: "bridge alive (pid 1234)",
      queuedJobs: [],
      tasks: [openTask, mergedTask, abandonedTask],
      all: false,
    });

    // Open task has full detail
    expect(output).toContain("task-active  [running] round 0");
    expect(output).toContain("conversation -");

    // Closed tasks are in compact list at the end
    expect(formatClosedTaskCompact(mergedTask)).toBe(
      "  - task-done                [merged] round 0",
    );
    expect(output).toContain("Closed tasks (2, use --all to show details):");
    expect(output).toContain("  - task-done                [merged] round 0");
    expect(output).toContain("  - task-dropped             [abandoned] round 1");

    // Closed tasks should not have multiline details in compact mode
    const linesAfterClosedHeader = output.slice(output.indexOf("Closed tasks (2"));
    expect(linesAfterClosedHeader).not.toContain("conversation");
    expect(linesAfterClosedHeader).not.toContain("branch");
  });

  it("shows full details for closed tasks when --all is specified (all: true)", () => {
    const mergedTask = buildTaskStatusInfo({
      taskId: "task-done",
      taskDir: "/nonexistent",
      task: { branch: "feat/task-done", createdAt: fourHoursAgo },
      state: { status: "merged", round: 0, conversationId: "conv-1234" },
      now,
    });

    const output = formatStatusReport({
      bridgeHealthText: "bridge alive (pid 1234)",
      queuedJobs: [],
      tasks: [mergedTask],
      all: true,
    });

    expect(output).toContain("task-done  [merged] round 0");
    expect(output).toContain("branch feat/task-done");
    expect(output).toContain("conversation conv-1234");
    expect(output).not.toContain("use --all to show details");
    // Still no budget for closed tasks
    expect(output).not.toContain("budget:");
  });
});
