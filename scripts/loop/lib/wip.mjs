/**
 * WIP limits and queueing logic for the engineering loop.
 *
 * Config key: maxParallel in .loop/config.json (default 3).
 * A task counts as running if state.status === "running" AND latestReport.status is
 * neither "ready-for-review" nor "blocked".
 * "new" and "resume" jobs are gated by maxParallel. Feedback / send jobs for existing tasks
 * proceed so running tasks can finish. Extra "new" / "resume" jobs stay queued (FIFO).
 */

export const DEFAULT_MAX_PARALLEL = 3;

/**
 * Determines whether a task counts as running without a final report.
 *
 * @param {Record<string, any>} state
 * @param {string | null | undefined} reportStatus
 * @returns {boolean}
 */
export function isTaskRunningWithoutFinalReport(state, reportStatus) {
  if (!state || state.status !== "running") {
    return false;
  }
  if (reportStatus === "ready-for-review" || reportStatus === "blocked") {
    return false;
  }
  return true;
}

/**
 * Determines whether a new job can be started given the number of currently running tasks.
 *
 * @param {number} activeRunningCount
 * @param {number} [maxParallel=DEFAULT_MAX_PARALLEL]
 * @returns {boolean}
 */
export function canDispatchNewJob(activeRunningCount, maxParallel = DEFAULT_MAX_PARALLEL) {
  const limit = Number(maxParallel ?? DEFAULT_MAX_PARALLEL);
  return activeRunningCount < limit;
}

/**
 * Filters a list of queued jobs according to WIP limit (FIFO).
 *
 * @param {Array<{ op: string, taskId: string, [key: string]: any }>} queueJobs
 * @param {number} initialRunningCount
 * @param {number} [maxParallel=DEFAULT_MAX_PARALLEL]
 * @returns {{
 *   runnable: Array<{ op: string, taskId: string, [key: string]: any }>,
 *   blocked: Array<{ op: string, taskId: string, [key: string]: any }>
 * }}
 */
export function filterQueueByWip(
  queueJobs,
  initialRunningCount,
  maxParallel = DEFAULT_MAX_PARALLEL,
) {
  const limit = Number(maxParallel ?? DEFAULT_MAX_PARALLEL);
  let simulatedRunning = initialRunningCount;
  const runnable = [];
  const blocked = [];

  for (const job of queueJobs) {
    if (job.op === "new" || job.op === "resume") {
      if (simulatedRunning < limit) {
        simulatedRunning++;
        runnable.push(job);
      } else {
        blocked.push(job);
      }
    } else {
      // Feedback or other operations on existing tasks do not consume a new task slot
      runnable.push(job);
    }
  }

  return { runnable, blocked };
}
