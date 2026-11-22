/**
 * Agentapi error classifier for the engineering loop.
 *
 * Classifies agentapi output to identify lost conversations,
 * server mismatches, and other failure modes.
 */

export const LOST_CONVERSATION_PATTERN = /(?:trajectory|conversation)\s*not found|\bnot found\b/i;
export const WRONG_SERVER_PATTERN = /projectsStore is nil|project_id is required/i;

/**
 * Extracts a normalized error message from various error shapes.
 *
 * @param {any} error
 * @returns {string}
 */
export function extractErrorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error.err === "string") return error.err;
  if (typeof error.error === "string") return error.error;
  if (typeof error.message === "string") return error.message;
  if (error.json?.error) return String(error.json.error);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Classifies an agentapi error.
 *
 * Note: A "not found" from the wrong server looks exactly like a lost
 * conversation; it is only classified as lost when the owning server says so.
 *
 * @param {any} error
 * @param {{
 *   server?: string,
 *   owningServer?: string,
 *   isOwningServer?: boolean
 * }} [context={}]
 * @returns {{
 *   kind: "conversation_lost" | "wrong_server" | "other",
 *   isLost: boolean,
 *   isWrongServer: boolean,
 *   reason: string
 * }}
 */
export function classifyAgentapiError(error, context = {}) {
  const msg = extractErrorMessage(error);
  const { server, owningServer, isOwningServer } = context;

  // If server ownership context indicates this call went to the wrong server,
  // do not classify as a lost conversation.
  if (isOwningServer === false) {
    return {
      kind: "wrong_server",
      isLost: false,
      isWrongServer: true,
      reason: "error from non-owning server",
    };
  }
  if (server && owningServer && server !== owningServer) {
    return {
      kind: "wrong_server",
      isLost: false,
      isWrongServer: true,
      reason: `server mismatch: call made to ${server} but conversation is owned by ${owningServer}`,
    };
  }

  if (WRONG_SERVER_PATTERN.test(msg)) {
    return {
      kind: "wrong_server",
      isLost: false,
      isWrongServer: true,
      reason: msg,
    };
  }

  if (LOST_CONVERSATION_PATTERN.test(msg)) {
    return {
      kind: "conversation_lost",
      isLost: true,
      isWrongServer: false,
      reason: msg,
    };
  }

  return {
    kind: "other",
    isLost: false,
    isWrongServer: false,
    reason: msg,
  };
}

/**
 * Pure predicate: returns true if the error represents a lost conversation
 * from the owning language server.
 *
 * @param {any} error
 * @param {{
 *   server?: string,
 *   owningServer?: string,
 *   isOwningServer?: boolean
 * }} [context={}]
 * @returns {boolean}
 */
export function isConversationLost(error, context = {}) {
  return classifyAgentapiError(error, context).isLost;
}
