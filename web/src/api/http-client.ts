import { invalidResponseError, networkError, parseApiError } from "./api-error";

/** Signature of `fetch`, injectable for tests. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Minimal JSON transport over HTTP that converts every failure into an `ApiError`. */
export interface HttpClient {
  /**
   * Sends a request and returns the parsed JSON body.
   *
   * @param path - Path relative to the API base URL.
   * @param init - Optional fetch options.
   * @returns Parsed JSON body, or `undefined` for `204 No Content`.
   * @throws {ApiError} On network failure, non-2xx status or invalid JSON.
   */
  request(path: string, init?: RequestInit): Promise<unknown>;
}

/**
 * Creates an {@link HttpClient}.
 *
 * @param buildUrl - Turns a path into an absolute URL.
 * @param fetchFn - Fetch implementation (defaults to the global one).
 * @returns The client.
 */
export function createHttpClient(
  buildUrl: (path: string) => string,
  fetchFn: FetchFn = (input, init) => fetch(input, init),
): HttpClient {
  return {
    async request(path: string, init?: RequestInit): Promise<unknown> {
      const headers = new Headers(init?.headers);
      headers.set("Accept", "application/json");
      let response: Response;
      try {
        response = await fetchFn(buildUrl(path), { ...init, headers });
      } catch {
        throw networkError();
      }

      if (!response.ok) {
        throw parseApiError(response.status, await readJson(response));
      }
      if (response.status === 204) {
        return undefined;
      }
      const body = await readJson(response);
      if (body === undefined) {
        throw invalidResponseError(response.status);
      }
      return body;
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}
