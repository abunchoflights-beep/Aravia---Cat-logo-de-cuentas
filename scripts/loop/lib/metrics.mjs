/**
 * Metrics tracking and aggregation for the engineering loop.
 *
 * Events are written to .loop/metrics.jsonl, one JSON line per event:
 * - dispatched: { event: "dispatched", taskId, timestamp, model? }
 * - report: { event: "report", taskId, round, status, timestamp }
 * - verify: { event: "verify", taskId, round, passed, findingsCount, timestamp }
 * - feedback: { event: "feedback", taskId, round, timestamp }
 * - escalated: { event: "escalated", taskId, round, reason, timestamp }
 * - closed: { event: "closed", taskId, result: "merged" | "abandoned", timestamp }
 * - conversation_lost: { event: "conversation_lost", taskId, round, error, timestamp }
 * - resumed: { event: "resumed", taskId, round, timestamp, model? }
 * - nudged: { event: "nudged", taskId, round, timestamp }
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Appends an event to .loop/metrics.jsonl.
 *
 * @param {string} loopDir
 * @param {Record<string, any>} eventData
 */
export function appendMetric(loopDir, eventData) {
  try {
    fs.mkdirSync(loopDir, { recursive: true });
    const metricFile = path.join(loopDir, "metrics.jsonl");
    const payload = {
      ...eventData,
      timestamp: eventData.timestamp || new Date().toISOString(),
    };
    fs.appendFileSync(metricFile, JSON.stringify(payload) + "\n", "utf8");
  } catch (err) {
    // Non-fatal error
    console.error(`[metrics] failed to append metric: ${err.message}`);
  }
}

/**
 * Reads and parses all metrics events from metrics.jsonl.
 *
 * @param {string} loopDir
 * @returns {Array<Record<string, any>>}
 */
export function readMetrics(loopDir) {
  const metricFile = path.join(loopDir, "metrics.jsonl");
  if (!fs.existsSync(metricFile)) return [];
  try {
    const content = fs.readFileSync(metricFile, "utf8");
    return content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Formats duration in milliseconds into a concise string (e.g. "45m" or "2h 15m").
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

/**
 * Aggregates raw metric events into per-task statistics and overall totals.
 *
 * @param {Array<Record<string, any>>} events
 * @returns {{
 *   tasks: Array<{
 *     taskId: string,
 *     rounds: number,
 *     firstPassVerify: "passed" | "failed" | "none",
 *     wallTimeMs: number,
 *     wallTimeString: string,
 *     status: string
 *   }>,
 *   totals: {
 *     firstPassAcceptanceRate: string,
 *     firstPassPassCount: number,
 *     firstPassTotalCount: number,
 *     meanRounds: number,
 *     tasksMerged: number,
 *     totalTasks: number
 *   }
 * }}
 */
export function computeMetricsSummary(events = []) {
  const taskMap = new Map();

  for (const ev of events) {
    const tid = ev.taskId;
    if (!tid) continue;
    if (!taskMap.has(tid)) {
      taskMap.set(tid, {
        taskId: tid,
        events: [],
        firstPassVerify: "none",
        firstVerifyRound: null,
        rounds: 0,
        status: "active",
      });
    }
    const t = taskMap.get(tid);
    t.events.push(ev);

    if (typeof ev.round === "number") {
      t.rounds = Math.max(t.rounds, ev.round);
    }

    if (ev.event === "verify" && t.firstPassVerify === "none") {
      t.firstPassVerify = ev.passed ? "passed" : "failed";
      t.firstVerifyRound = ev.round ?? 0;
    }

    if (ev.event === "closed") {
      t.status = ev.result || "closed";
    } else if (ev.event === "escalated" && t.status !== "merged") {
      t.status = "escalated";
    } else if (
      ev.event === "conversation_lost" &&
      t.status !== "merged" &&
      t.status !== "abandoned"
    ) {
      t.status = "conversation_lost";
    } else if (ev.event === "resumed" && t.status === "conversation_lost") {
      t.status = "active";
    }
  }

  const tasks = [];
  let firstPassPassCount = 0;
  let firstPassTotalCount = 0;
  let sumRounds = 0;
  let tasksMerged = 0;
  let mergedWithoutFeedbackCount = 0;

  for (const [taskId, t] of taskMap.entries()) {
    // Determine wall time from earliest timestamp to latest timestamp
    const timestamps = t.events
      .map((e) => (e.timestamp ? new Date(e.timestamp).getTime() : NaN))
      .filter((ts) => !isNaN(ts))
      .sort((a, b) => a - b);

    const start = timestamps[0] || 0;
    const end = timestamps[timestamps.length - 1] || start;
    const wallTimeMs = Math.max(0, end - start);

    if (t.firstPassVerify !== "none") {
      firstPassTotalCount++;
      if (t.firstPassVerify === "passed") {
        firstPassPassCount++;
      }
    }

    sumRounds += t.rounds;
    if (t.status === "merged") {
      tasksMerged++;
      const hasFeedback = t.events.some((e) => e.event === "feedback");
      if (t.rounds === 0 && !hasFeedback) {
        mergedWithoutFeedbackCount++;
      }
    }

    tasks.push({
      taskId,
      rounds: t.rounds,
      firstPassVerify: t.firstPassVerify,
      wallTimeMs,
      wallTimeString: formatDuration(wallTimeMs),
      status: t.status,
    });
  }

  const totalTasks = tasks.length;
  const ratePct =
    firstPassTotalCount > 0 ? ((firstPassPassCount / firstPassTotalCount) * 100).toFixed(1) : "0.0";
  const firstVerifyPassed = `${ratePct}% (${firstPassPassCount}/${firstPassTotalCount})`;

  const mergedRatePct =
    tasksMerged > 0 ? ((mergedWithoutFeedbackCount / tasksMerged) * 100).toFixed(1) : "0.0";
  const mergedWithoutFeedback = `${mergedRatePct}% (${mergedWithoutFeedbackCount}/${tasksMerged})`;

  const meanRounds = totalTasks > 0 ? parseFloat((sumRounds / totalTasks).toFixed(2)) : 0;

  return {
    tasks,
    totals: {
      firstVerifyPassed,
      firstVerifyPassCount: firstPassPassCount,
      firstVerifyTotalCount: firstPassTotalCount,
      firstPassAcceptanceRate: firstVerifyPassed,
      firstPassPassCount,
      firstPassTotalCount,
      mergedWithoutFeedback,
      mergedWithoutFeedbackCount,
      meanRounds,
      tasksMerged,
      totalTasks,
    },
  };
}

/**
 * Renders a human-readable table of metrics.
 *
 * @param {ReturnType<typeof computeMetricsSummary>} summary
 * @returns {string}
 */
export function formatMetricsReport(summary) {
  const { tasks, totals } = summary;
  const lines = [];

  lines.push("\n=== Loop Metrics: Task Summary ===");
  if (tasks.length === 0) {
    lines.push("No task events recorded yet.");
  } else {
    lines.push(
      `${"Task ID".padEnd(24)} ${"Rounds".padStart(6)}   ${"First Verify".padEnd(14)} ${"Wall Time".padEnd(10)} ${"Status".padEnd(10)}`,
    );
    lines.push("-".repeat(70));
    for (const t of tasks) {
      lines.push(
        `${t.taskId.padEnd(24)} ${String(t.rounds).padStart(6)}   ${t.firstPassVerify.padEnd(14)} ${t.wallTimeString.padEnd(10)} ${t.status.padEnd(10)}`,
      );
    }
  }

  lines.push("\n=== Totals ===");
  lines.push(`Tasks recorded:              ${totals.totalTasks}`);
  lines.push(`Tasks merged:                ${totals.tasksMerged}`);
  lines.push(`First verify passed:         ${totals.firstVerifyPassed}`);
  lines.push(`Merged without feedback:     ${totals.mergedWithoutFeedback}`);
  lines.push(`Mean rounds:                 ${totals.meanRounds}`);
  lines.push("");

  return lines.join("\n");
}
