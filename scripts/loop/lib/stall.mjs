/**
 * Stall detector and auto-nudge logic for the engineering loop.
 *
 * For each running task in its current round, tracks the last activity time:
 * - latest mtime of any file under the task's worktree (excluding node_modules, .next, .git)
 * - latest commit time in git
 * - round start
 *
 * If inactive for stallMinutes (default 30) with no final report, triggers an auto-nudge.
 * If still inactive stallMinutes after the nudge, marks the task stalled.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_STALL_MINUTES = 30;
export const WALK_THROTTLE_MS = 60_000;
export const DEFAULT_EXCLUDES = ["node_modules", ".next", ".git", "dist", ".vitest"];

/**
 * Recursively walks a directory and returns the latest mtime (in ms) of any file,
 * ignoring directories matching the exclude list.
 *
 * @param {string} worktreeDir
 * @param {{ exclude?: string[] }} [options]
 * @returns {number} latest mtime in milliseconds, or 0 if empty/nonexistent
 */
export function getWorktreeLatestMtime(worktreeDir, { exclude = DEFAULT_EXCLUDES } = {}) {
  if (!worktreeDir || !fs.existsSync(worktreeDir)) return 0;
  const excludeSet = new Set(exclude);
  let maxMtime = 0;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (excludeSet.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs > maxMtime) {
            maxMtime = stat.mtimeMs;
          }
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  walk(worktreeDir);
  return maxMtime;
}

/**
 * Returns the latest commit time (in ms) in the worktree git repository.
 *
 * @param {string} worktreeDir
 * @param {{ execGit?: (cmd: string, args: string[], opts: any) => string }} [options]
 * @returns {number} commit timestamp in ms, or 0 if failed/no commits
 */
export function getLatestCommitTime(worktreeDir, { execGit = execFileSync } = {}) {
  if (!worktreeDir || !fs.existsSync(worktreeDir)) return 0;
  try {
    const out = execGit("git", ["-C", worktreeDir, "log", "-1", "--format=%cI"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) {
      const t = new Date(out).getTime();
      return isNaN(t) ? 0 : t;
    }
  } catch {
    // Non-fatal fallback
  }
  return 0;
}

/**
 * Computes the last activity timestamp among worktree mtime, git commit time, and round start.
 *
 * @param {{
 *   worktreeLatestMtime?: number | string | null,
 *   latestCommitTime?: number | string | null,
 *   roundStartedAt?: number | string | null
 * }} params
 * @returns {number} latest activity timestamp in ms
 */
export function computeLastActivityTime({
  worktreeLatestMtime = 0,
  latestCommitTime = 0,
  roundStartedAt = 0,
} = {}) {
  const roundMs =
    typeof roundStartedAt === "number"
      ? roundStartedAt
      : roundStartedAt
        ? new Date(roundStartedAt).getTime()
        : 0;

  const commitMs =
    typeof latestCommitTime === "number"
      ? latestCommitTime
      : latestCommitTime
        ? new Date(latestCommitTime).getTime()
        : 0;

  const mtimeMs =
    typeof worktreeLatestMtime === "number"
      ? worktreeLatestMtime
      : worktreeLatestMtime
        ? new Date(worktreeLatestMtime).getTime()
        : 0;

  return Math.max(roundMs || 0, commitMs || 0, mtimeMs || 0);
}

/**
 * Creates a throttled tracker for filesystem walks to limit walk frequency
 * to at most once per minute per task.
 *
 * @param {{
 *   walkFn?: (worktree: string) => number,
 *   throttleMs?: number
 * }} [options]
 * @returns {{
 *   getLatestMtime: (taskId: string, worktreeDir: string, opts?: { now?: number }) => number,
 *   clear: (taskId?: string) => void
 * }}
 */
export function createMtimeTracker({
  walkFn = getWorktreeLatestMtime,
  throttleMs = WALK_THROTTLE_MS,
} = {}) {
  const cache = new Map();

  return {
    getLatestMtime(taskId, worktreeDir, { now = Date.now() } = {}) {
      const entry = cache.get(taskId);
      if (entry && now - entry.lastWalkAt < throttleMs) {
        return entry.cachedMtime;
      }
      const mtime = walkFn(worktreeDir);
      cache.set(taskId, { lastWalkAt: now, cachedMtime: mtime });
      return mtime;
    },
    clear(taskId) {
      if (taskId) cache.delete(taskId);
      else cache.clear();
    },
  };
}

/**
 * Pure evaluation of stall status.
 *
 * - If status is not "running" or task has a final report, action is "none".
 * - If not yet nudged and time since last activity >= stallMinutes, action is "nudge".
 * - If already nudged:
 *     - If activity happened after the nudge, inactivity is measured from that activity.
 *     - If no activity after the nudge, inactivity is measured from the nudge.
 *     - If inactivity >= stallMinutes, action is "stall".
 *
 * @param {{
 *   status?: string,
 *   hasFinalReport?: boolean,
 *   lastActivityAt: number | string,
 *   nudgedAt?: number | string | null,
 *   stallMinutes?: number,
 *   now?: number
 * }} params
 * @returns {{
 *   action: "none" | "nudge" | "stall",
 *   elapsedSinceActivityMinutes: number,
 *   elapsedSinceNudgeMinutes?: number
 * }}
 */
export function checkStallStatus({
  status = "running",
  hasFinalReport = false,
  lastActivityAt,
  nudgedAt = null,
  stallMinutes = DEFAULT_STALL_MINUTES,
  now = Date.now(),
}) {
  if (status !== "running" || hasFinalReport) {
    return { action: "none", elapsedSinceActivityMinutes: 0 };
  }

  const stallMs = stallMinutes * 60_000;
  const lastActivityMs =
    typeof lastActivityAt === "number"
      ? lastActivityAt
      : lastActivityAt
        ? new Date(lastActivityAt).getTime()
        : 0;

  const nudgedMs =
    typeof nudgedAt === "number" ? nudgedAt : nudgedAt ? new Date(nudgedAt).getTime() : null;

  const elapsedSinceActivityMs = Math.max(0, now - lastActivityMs);
  const elapsedSinceActivityMinutes = Math.floor(elapsedSinceActivityMs / 60_000);

  if (!nudgedMs) {
    if (elapsedSinceActivityMs >= stallMs) {
      return {
        action: "nudge",
        elapsedSinceActivityMinutes,
      };
    }
    return {
      action: "none",
      elapsedSinceActivityMinutes,
    };
  }

  // Already nudged once:
  const elapsedSinceNudgeMs = Math.max(0, now - nudgedMs);
  const elapsedSinceNudgeMinutes = Math.floor(elapsedSinceNudgeMs / 60_000);

  const referenceMs = Math.max(lastActivityMs, nudgedMs);
  const inactiveSinceRefMs = Math.max(0, now - referenceMs);

  if (inactiveSinceRefMs >= stallMs) {
    return {
      action: "stall",
      elapsedSinceActivityMinutes,
      elapsedSinceNudgeMinutes,
    };
  }

  return {
    action: "none",
    elapsedSinceActivityMinutes,
    elapsedSinceNudgeMinutes,
  };
}

/**
 * Formats the auto-nudge prompt sent to the agent.
 *
 * @param {{
 *   taskId: string,
 *   round: number,
 *   taskDir?: string
 * }} params
 * @returns {string}
 */
export function formatNudgePrompt({ taskId, round, taskDir }) {
  const briefRef = taskDir ? `brief.md at ${path.join(taskDir, "brief.md")}` : "brief.md";
  const fbRef = taskDir
    ? `feedback-${round}.md at ${path.join(taskDir, `feedback-${round}.md`)}`
    : `feedback-${round}.md`;

  const reread = round > 0 ? `re-read ${briefRef} and ${fbRef}` : `re-read ${briefRef}`;

  return `Task ${taskId} appears stalled in round ${round}. Please check git log and git status in the worktree for what is already done, ${reread}, finish the work, run the gates, and write report-${round}.md. If you are blocked, report LOOP-STATUS: blocked instead of stopping silently.`;
}

/**
 * Evaluates stall status for a task, integrating mtime walking (throttled) and commit time.
 *
 * @param {{
 *   taskId: string,
 *   worktree?: string,
 *   state: Record<string, any>,
 *   task?: Record<string, any>,
 *   reportStatus?: string | null,
 *   config?: Record<string, any>,
 *   now?: number,
 *   mtimeTracker?: ReturnType<typeof createMtimeTracker>,
 *   getCommitTime?: (worktree: string) => number
 * }} params
 * @returns {{
 *   action: "none" | "nudge" | "stall",
 *   lastActivityAt: number,
 *   stallMinutes: number,
 *   round: number,
 *   elapsedSinceActivityMinutes: number,
 *   elapsedSinceNudgeMinutes?: number
 * }}
 */
export function evaluateTaskStall({
  taskId,
  worktree,
  state,
  task = {},
  reportStatus = null,
  config = {},
  now = Date.now(),
  mtimeTracker,
  getCommitTime = getLatestCommitTime,
}) {
  const stallMinutes = Number(task.stallMinutes ?? config.stallMinutes ?? DEFAULT_STALL_MINUTES);
  const round = state.round ?? 0;
  const roundStartedAt = state.roundStartedAt || task.createdAt;
  const hasFinalReport = reportStatus === "ready-for-review" || reportStatus === "blocked";

  const worktreeLatestMtime = mtimeTracker
    ? mtimeTracker.getLatestMtime(taskId, worktree || "", { now })
    : getWorktreeLatestMtime(worktree || "");

  const latestCommitTime = getCommitTime(worktree || "");

  const lastActivityAt = computeLastActivityTime({
    worktreeLatestMtime,
    latestCommitTime,
    roundStartedAt,
  });

  const stallCheck = checkStallStatus({
    status: state.status,
    hasFinalReport,
    lastActivityAt,
    nudgedAt: state.nudgedAt,
    stallMinutes,
    now,
  });

  return {
    ...stallCheck,
    lastActivityAt,
    stallMinutes,
    round,
  };
}
