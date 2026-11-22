/**
 * Round cap, task escalation, time budget, and round-state tracking for the engineering loop.
 */
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_MAX_ROUNDS = 3;
export const DEFAULT_BUDGET_MINUTES = 180;
export const STATUS_RE = /^LOOP-STATUS:\s*(ready-for-review|blocked)\b.*$/m;

/**
 * Validates whether another feedback round is allowed.
 *
 * @param {{ round: number, maxRounds?: number }} params
 * @returns {{ allowed: boolean, round: number, maxRounds: number }}
 */
export function checkRoundCap({ round, maxRounds = DEFAULT_MAX_ROUNDS }) {
  const cap = Number(maxRounds ?? DEFAULT_MAX_ROUNDS);
  return {
    allowed: round <= cap,
    round,
    maxRounds: cap,
  };
}

/**
 * Checks whether a round (or task) has exceeded its time budget.
 *
 * Measures from `startedAt` (the start of the current round).
 * Falls back to `createdAt` for tasks created before per-round tracking.
 *
 * @param {{
 *   startedAt?: string,
 *   createdAt?: string,
 *   budgetMinutes?: number,
 *   now?: number
 * }} params
 * @returns {{
 *   elapsedMinutes: number,
 *   budgetMinutes: number,
 *   overBudget: boolean,
 *   remainingMinutes: number
 * }}
 */
export function checkBudget({
  startedAt,
  createdAt,
  budgetMinutes = DEFAULT_BUDGET_MINUTES,
  now = Date.now(),
}) {
  const budget = Number(budgetMinutes ?? DEFAULT_BUDGET_MINUTES);
  const startTime = startedAt || createdAt;
  if (!startTime) {
    return {
      elapsedMinutes: 0,
      budgetMinutes: budget,
      overBudget: false,
      remainingMinutes: budget,
    };
  }
  const createdTime = new Date(startTime).getTime();
  const elapsedMs = Math.max(0, now - createdTime);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  const overBudget = elapsedMinutes > budget;
  const remainingMinutes = Math.max(0, budget - elapsedMinutes);

  return {
    elapsedMinutes,
    budgetMinutes: budget,
    overBudget,
    remainingMinutes,
  };
}

/**
 * Finds the highest feedback round N with a feedback-N.md present in taskDir.
 *
 * @param {string} taskDir
 * @returns {number}
 */
export function getHighestFeedbackRound(taskDir) {
  if (!taskDir || !fs.existsSync(taskDir)) return 0;
  try {
    const files = fs.readdirSync(taskDir);
    let highest = 0;
    for (const f of files) {
      const m = f.match(/^feedback-(\d+)\.md$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > highest) highest = n;
      }
    }
    return highest;
  } catch {
    return 0;
  }
}

/**
 * Resolves the expected round, accounting for feedback that is queued but not yet delivered.
 * expectedRound = max(state.round, highest N with a feedback-N.md present)
 *
 * @param {Record<string, any>} [state={}]
 * @param {string} [taskDir=""]
 * @returns {number}
 */
export function getExpectedRound(state, taskDir) {
  const stateRound = state?.round ?? 0;
  const fbRound = taskDir ? getHighestFeedbackRound(taskDir) : 0;
  return Math.max(stateRound, fbRound);
}

/**
 * Checks report status for a specific round in taskDir.
 *
 * @param {string} taskDir
 * @param {number} round
 * @returns {{ round: number, path: string, status: "ready-for-review" | "blocked" | "writing" | null }}
 */
export function getLatestReport(taskDir, round = 0) {
  const p = path.join(taskDir, `report-${round}.md`);
  if (!fs.existsSync(p)) return { round, path: p, status: null };
  try {
    const content = fs.readFileSync(p, "utf8");
    const m = content.match(STATUS_RE);
    return { round, path: p, status: m ? m[1] : "writing" };
  } catch {
    return { round, path: p, status: null };
  }
}

/**
 * Marks task state as escalated.
 *
 * @param {{
 *   taskId: string,
 *   round: number,
 *   maxRounds?: number,
 *   reason?: string,
 *   state: Record<string, any>
 * }} params
 * @returns {{ escalated: boolean, message: string }}
 */
export function escalateTask({ taskId, round, maxRounds = DEFAULT_MAX_ROUNDS, reason, state }) {
  const msg =
    reason || `Reached round cap (${round} > ${maxRounds} rounds). Human intervention required.`;
  state.status = "escalated";
  state.escalatedAt = new Date().toISOString();
  state.escalationReason = msg;

  return {
    escalated: true,
    message: `[ESCALATED] Task ${taskId} has been escalated: ${msg}`,
  };
}

/**
 * Marks task as closed (merged or abandoned).
 *
 * @param {{
 *   taskId: string,
 *   outcome: "merged" | "abandoned",
 *   state: Record<string, any>
 * }} params
 * @returns {Record<string, any>}
 */
export function closeTask({ taskId, outcome, state }) {
  if (outcome !== "merged" && outcome !== "abandoned") {
    throw new Error(`Invalid close outcome: ${String(outcome)}. Must be "merged" or "abandoned".`);
  }
  if (taskId) state.taskId = taskId;
  state.status = outcome;
  state.closedAt = new Date().toISOString();
  state.closeReason = outcome;
  return state;
}

/**
 * Transitions task state to conversation_lost.
 *
 * @param {{
 *   state: Record<string, any>,
 *   error: string,
 *   at?: string
 * }} params
 * @returns {Record<string, any>}
 */
export function markConversationLost({ state, error, at = new Date().toISOString() }) {
  state.status = "conversation_lost";
  state.lostAt = at;
  state.lostError = error;
  state.error = error;
  return state;
}

/**
 * Validates whether a task is allowed to be resumed.
 * Refuses closed tasks (merged or abandoned).
 *
 * @param {Record<string, any>} state
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canResumeTask(state) {
  if (!state) return { allowed: false, reason: "No task state provided" };
  if (state.status === "merged" || state.status === "abandoned") {
    return {
      allowed: false,
      reason: `Cannot resume task with status "${state.status}". Closed tasks cannot be resumed.`,
    };
  }
  return { allowed: true };
}

/**
 * Prepares task state for resume: preserves history, archives current conversationId
 * into previousConversations, sets new conversationId and running status, and clears lost error.
 *
 * @param {{
 *   state: Record<string, any>,
 *   newConversationId?: string | null,
 *   server?: string,
 *   round?: number,
 *   at?: string
 * }} params
 * @returns {Record<string, any>}
 */
export function prepareTaskForResume({
  state,
  newConversationId,
  server,
  round,
  at = new Date().toISOString(),
}) {
  const previous = Array.isArray(state.previousConversations)
    ? [...state.previousConversations]
    : [];
  if (state.conversationId && !previous.includes(state.conversationId)) {
    previous.push(state.conversationId);
  }
  state.previousConversations = previous;
  state.conversationId = newConversationId ?? null;
  state.status = "running";
  if (server) state.server = server;
  if (round !== undefined) state.round = round;
  state.roundStartedAt = at;
  delete state.lostAt;
  delete state.lostError;
  delete state.stalledAt;
  delete state.stalledReason;
  delete state.nudgedAt;
  return state;
}

/**
 * Formats the prompt sent to Antigravity when resuming a task.
 * Mentions task id, round N, brief.md, and if N > 0, feedback-N.md,
 * instructs to check git log and git status for work already done, and write report-N.md.
 *
 * @param {{
 *   taskId: string,
 *   round: number,
 *   taskDir?: string
 * }} params
 * @returns {string}
 */
export function formatResumePrompt({ taskId, round, taskDir }) {
  const briefRef = taskDir ? `brief.md at ${path.join(taskDir, "brief.md")}` : "brief.md";
  const fbRef = taskDir
    ? `feedback-${round}.md at ${path.join(taskDir, `feedback-${round}.md`)}`
    : `feedback-${round}.md`;

  if (round > 0) {
    return `This resumes task ${taskId} in round ${round}: read ${briefRef} and ${fbRef}, check git log and git status in the worktree for what is already done, finish, and write report-${round}.md.`;
  }
  return `This resumes task ${taskId} in round ${round}: read ${briefRef}, check git log and git status in the worktree for what is already done, finish, and write report-${round}.md.`;
}

/**
 * Determines whether the wait command should exit or keep waiting.
 * Immediately exits on conversation_lost, over_budget, escalated, or *_failed.
 * Exits done on ready-for-review or blocked.
 *
 * @param {{
 *   state?: Record<string, any>,
 *   report?: { status: string | null },
 *   isDelivering?: boolean
 * }} params
 * @returns {{
 *   action: "exit_error" | "done" | "continue",
 *   status?: string,
 *   reason?: string
 * }}
 */
export function checkWaitStatus({ state, report, isDelivering }) {
  if (state?.status === "conversation_lost") {
    return {
      action: "exit_error",
      status: "conversation_lost",
      reason: state.lostError || state.error || "conversation was lost",
    };
  }

  if (state?.status === "stalled") {
    return {
      action: "exit_error",
      status: "stalled",
      reason: state.stalledReason || "task stalled with no activity after nudge",
    };
  }

  if (!isDelivering) {
    if (report?.status === "ready-for-review" || report?.status === "blocked") {
      return { action: "done", status: report.status };
    }
    if (state?.status === "escalated") {
      return { action: "exit_error", status: "escalated", reason: state.escalationReason };
    }
    if (state?.status?.endsWith("_failed")) {
      return {
        action: "exit_error",
        status: state.status,
        reason: state.history?.at(-1)?.error ?? "",
      };
    }
  }

  return { action: "continue" };
}
