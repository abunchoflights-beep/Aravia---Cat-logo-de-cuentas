/** Validated runtime configuration of the API. */
export interface AppEnv {
  readonly port: number;
  readonly webOrigin: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_WEB_ORIGIN = 'http://localhost:5173';

/**
 * Parses and validates environment variables at bootstrap so misconfiguration fails fast.
 *
 * @param env - Raw environment (usually `process.env`).
 * @returns The validated configuration.
 * @throws {Error} When `PORT` is not a valid TCP port or `WEB_ORIGIN` is not an http(s) origin.
 */
export function parseEnv(env: Readonly<Record<string, string | undefined>>): AppEnv {
  const rawPort = env.PORT ?? String(DEFAULT_PORT);
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65_535) {
    throw new Error(`La variable PORT ("${rawPort}") debe ser un puerto entre 1 y 65535.`);
  }

  const webOrigin = env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN;
  if (!isHttpOrigin(webOrigin)) {
    throw new Error(
      `La variable WEB_ORIGIN ("${webOrigin}") debe ser un origen http(s), por ejemplo http://localhost:5173.`,
    );
  }

  return { port, webOrigin };
}

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}
