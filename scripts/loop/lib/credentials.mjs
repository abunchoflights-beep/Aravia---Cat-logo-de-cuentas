/**
 * Credentials resolution for the Antigravity engineering loop bridge.
 *
 * Rule: Fresh credentials win.
 * ANTIGRAVITY_LS_ADDRESS and ANTIGRAVITY_CSRF_TOKEN from the environment take precedence.
 * .loop/config.json values (lsAddress, csrfToken) are only a fallback when the env lacks them.
 * Never print, log, or commit either value; the heartbeat may report the source ("env" | "config").
 */

/**
 * Resolves Antigravity LS address and CSRF token from env and config.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @param {Record<string, any>} [config={}]
 * @returns {{
 *   lsAddress: string | null,
 *   csrfToken: string | null,
 *   source: {
 *     lsAddress: "env" | "config" | "missing",
 *     csrfToken: "env" | "config" | "missing"
 *   }
 * }}
 */
export function resolveCredentials(env = process.env, config = {}) {
  const envLs = env.ANTIGRAVITY_LS_ADDRESS;
  const envCsrf = env.ANTIGRAVITY_CSRF_TOKEN;

  const configLs = config?.lsAddress;
  const configCsrf = config?.csrfToken;

  const lsAddress = envLs || configLs || null;
  const csrfToken = envCsrf || configCsrf || null;

  return {
    lsAddress,
    csrfToken,
    source: {
      lsAddress: envLs ? "env" : configLs ? "config" : "missing",
      csrfToken: envCsrf ? "env" : configCsrf ? "config" : "missing",
    },
  };
}

/**
 * Constructs the environment dictionary for agentapi child processes.
 *
 * @param {Record<string, string | undefined>} [baseEnv=process.env]
 * @param {Record<string, any>} [config={}]
 * @returns {Record<string, string | undefined>}
 */
export function agentapiEnv(baseEnv = process.env, config = {}) {
  const env = { ...baseEnv };
  if (config.projectId) env.ANTIGRAVITY_PROJECT_ID = config.projectId;

  const creds = resolveCredentials(baseEnv, config);
  if (creds.lsAddress) env.ANTIGRAVITY_LS_ADDRESS = creds.lsAddress;
  if (creds.csrfToken) env.ANTIGRAVITY_CSRF_TOKEN = creds.csrfToken;

  delete env.ANTIGRAVITY_CONVERSATION_ID;
  delete env.ANTIGRAVITY_SOURCE_METADATA;
  delete env.ANTIGRAVITY_TRAJECTORY_ID;
  return env;
}
