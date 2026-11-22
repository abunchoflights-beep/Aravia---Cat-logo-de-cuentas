/**
 * Status display formatting and task filtering for loop.mjs.
 *
 * Rules:
 * - Budget and "OVER BUDGET" are shown ONLY for tasks that are still open (not merged / abandoned).
 * - Closed tasks are listed compactly at the end, unless --all is specified.
 * - Stalled tasks are displayed prominently with a STALLED banner.
 */
import { checkBudget, getExpectedRound, getLatestReport } from "./rounds.mjs";

/**
 * Builds display metadata for a single task.
 *
 * @param {{
 *   taskId: string,
 *   taskDir: string,
 *   task?: Record<string, any>,
 *   state?: Record<string, any>,
 *   now?: number
 * }} params
 * @returns {Record<string, any>}
 */
export function buildTaskStatusInfo({ taskId, taskDir, task = {}, state = {}, now = Date.now() }) {
  const isClosed = state.status === "merged" || state.status === "abandoned";
  const expectedRound = getExpectedRound(state, taskDir);
  const rep = getLatestReport(taskDir, expectedRound);

  const isDelivering =
    state.status !== "conversation_lost" &&
    state.status !== "escalated" &&
    state.status !== "stalled" &&
    expectedRound > (state.round ?? 0);

  const displayStatus = isDelivering ? "delivering" : (state.status ?? "queued");
  const last = state.history?.at(-1);

  // Budget calculations only apply to open tasks
  let budgetStr = "";
  let isOverBudget = false;
  if (!isClosed && task.createdAt) {
    const roundStart = state.roundStartedAt || task.createdAt;
    const roundBudget = checkBudget({
      startedAt: roundStart,
      budgetMinutes: task.budgetMinutes,
      now,
    });
    isOverBudget = roundBudget.overBudget;
    const totalElapsed = Math.floor((now - new Date(task.createdAt).getTime()) / 60_000);
    budgetStr = `  budget: ${roundBudget.elapsedMinutes}m / ${roundBudget.budgetMinutes}m (round), total ${totalElapsed}m${
      isOverBudget ? " (OVER BUDGET)" : ""
    }\n`;
  }

  const lostBanner =
    state.status === "conversation_lost"
      ? `  *** CONVERSATION LOST *** (${state.lostError || state.error || "trajectory not found"})\n  Resume with: node scripts/loop/loop.mjs resume ${taskId}\n`
      : "";

  const stalledBanner =
    state.status === "stalled"
      ? `  *** STALLED *** (${state.stalledReason || "no activity after nudge"})\n  Resume with: node scripts/loop/loop.mjs resume ${taskId}\n`
      : "";

  const lastErrorStr =
    last && !last.ok && state.status !== "conversation_lost" ? `  last error: ${last.error}\n` : "";

  return {
    taskId,
    round: rep.round,
    reportStatus: rep.status,
    branch: task.branch ?? "?",
    conversationId: state.conversationId ?? "-",
    displayStatus,
    status: state.status ?? "queued",
    isClosed,
    isOverBudget,
    lostBanner,
    stalledBanner,
    budgetStr,
    lastErrorStr,
  };
}

/**
 * Formats the full detail block for a task.
 *
 * @param {ReturnType<typeof buildTaskStatusInfo>} info
 * @returns {string}
 */
export function formatTaskDetail(info) {
  return (
    `\n${info.taskId}  [${info.displayStatus}] round ${info.round}  report: ${info.reportStatus ?? "none yet"}\n` +
    `  branch ${info.branch}  conversation ${info.conversationId}\n` +
    info.lostBanner +
    info.stalledBanner +
    info.budgetStr +
    info.lastErrorStr
  );
}

/**
 * Formats a compact one-line summary for a closed task.
 *
 * @param {ReturnType<typeof buildTaskStatusInfo>} info
 * @returns {string}
 */
export function formatClosedTaskCompact(info) {
  return `  - ${info.taskId.padEnd(24)} [${info.status}] round ${info.round}`;
}

/**
 * Generates the complete status report output.
 *
 * @param {{
 *   bridgeHealthText?: string,
 *   queuedJobs?: Array<Record<string, any>>,
 *   tasks?: Array<ReturnType<typeof buildTaskStatusInfo>>,
 *   all?: boolean
 * }} params
 * @returns {string}
 */
export function formatStatusReport({
  bridgeHealthText = "",
  queuedJobs = [],
  tasks = [],
  all = false,
}) {
  const lines = [];

  if (bridgeHealthText) {
    lines.push(bridgeHealthText);
  }

  lines.push(`\nQueued jobs: ${queuedJobs.length}`);
  for (const job of queuedJobs) {
    lines.push(`  - ${job.taskId || "unknown"} (op: ${job.op || "?"}, round: ${job.round ?? 0})`);
  }

  const openTasks = tasks.filter((t) => !t.isClosed);
  const closedTasks = tasks.filter((t) => t.isClosed);

  for (const t of openTasks) {
    lines.push(formatTaskDetail(t).trimEnd());
  }

  if (closedTasks.length > 0) {
    if (all) {
      for (const t of closedTasks) {
        lines.push(formatTaskDetail(t).trimEnd());
      }
    } else {
      lines.push(`\nClosed tasks (${closedTasks.length}, use --all to show details):`);
      for (const t of closedTasks) {
        lines.push(formatClosedTaskCompact(t));
      }
    }
  }

  return lines.join("\n") + "\n";
}
