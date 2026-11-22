/** Frontend-only code for requests that never reached the server. */
export const NETWORK_ERROR_CODE = "ERROR_RED";

/** Frontend-only code for responses that do not follow the API contract. */
export const INVALID_RESPONSE_CODE = "RESPUESTA_INVALIDA";

const NETWORK_ERROR_MESSAGE =
  "No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.";

/** Spanish message per field name, as reported by the API (`details[].campo`). */
export type FieldErrors = Readonly<Record<string, string>>;

/** Constructor options of {@link ApiError}. */
export interface ApiErrorInit {
  readonly status: number | null;
  readonly code: string;
  readonly message: string;
  readonly fieldErrors?: FieldErrors;
}

/** Typed failure of an API call, carrying the Spanish message and per-field errors. */
export class ApiError extends Error {
  /** HTTP status, or `null` when the server was unreachable. */
  readonly status: number | null;
  /** Stable error code (e.g. `CODIGO_CUENTA_DUPLICADO`). */
  readonly code: string;
  /** Spanish message per field; empty when the error is not tied to a field. */
  readonly fieldErrors: FieldErrors;

  /**
   * Creates the error.
   *
   * @param init - Status, code, message and optional field errors.
   */
  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors ?? {};
  }
}

/**
 * Creates the error used when the server cannot be reached.
 *
 * @returns An `ERROR_RED` error.
 */
export function networkError(): ApiError {
  return new ApiError({ status: null, code: NETWORK_ERROR_CODE, message: NETWORK_ERROR_MESSAGE });
}

/**
 * Creates the error used when a response does not match the expected contract.
 *
 * @param status - HTTP status of the response.
 * @returns A `RESPUESTA_INVALIDA` error.
 */
export function invalidResponseError(status: number): ApiError {
  return new ApiError({
    status,
    code: INVALID_RESPONSE_CODE,
    message: "El servidor envió una respuesta inesperada. Inténtalo de nuevo más tarde.",
  });
}

/**
 * Parses the API error envelope into an {@link ApiError}.
 *
 * Accepts both detail shapes: a list of `{ campo, mensaje }` (validation) and a single
 * `{ campo, ... }` object (domain errors, whose message applies to that field).
 *
 * @param status - HTTP status of the failed response.
 * @param body - Parsed JSON body, or `undefined` when it was not JSON.
 * @returns The typed error.
 */
export function parseApiError(status: number, body: unknown): ApiError {
  if (!isRecord(body) || typeof body.code !== "string" || typeof body.message !== "string") {
    return new ApiError({
      status,
      code: "ERROR_INTERNO_SERVIDOR",
      message: `Ocurrió un error inesperado (HTTP ${status}). Inténtalo de nuevo más tarde.`,
    });
  }
  return new ApiError({
    status,
    code: body.code,
    message: body.message,
    fieldErrors: toFieldErrors(body.details, body.message),
  });
}

function toFieldErrors(details: unknown, message: string): FieldErrors {
  if (Array.isArray(details)) {
    const entries: Array<[string, string]> = [];
    for (const item of details) {
      if (isRecord(item) && typeof item.campo === "string" && typeof item.mensaje === "string") {
        entries.push([item.campo, item.mensaje]);
      }
    }
    return Object.fromEntries(entries);
  }
  if (isRecord(details) && typeof details.campo === "string") {
    return { [details.campo]: message };
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
