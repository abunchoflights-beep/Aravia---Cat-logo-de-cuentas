import type { ErrorCode } from './error-code.js';

/** Describes one invalid input field, in Spanish, for field-level rendering in clients. */
export interface FieldErrorDetail {
  readonly campo: string;
  readonly mensaje: string;
}

/** Structured context attached to an error: a field/value object or a list of field errors. */
export type ErrorDetails = Readonly<Record<string, unknown>> | ReadonlyArray<FieldErrorDetail>;

/**
 * Base class for every expected business failure.
 *
 * Framework-agnostic on purpose: the HTTP layer maps `code` to a status code, so the domain never
 * needs to know about transport concerns.
 */
export abstract class DomainException extends Error {
  /** Stable Spanish identifier of the failure. */
  readonly code: ErrorCode;
  /** Optional structured context (e.g. which field caused the failure). */
  readonly details?: ErrorDetails;

  /**
   * Creates a domain exception.
   *
   * @param code - Stable Spanish error code.
   * @param message - End-user-safe Spanish explanation.
   * @param details - Optional structured context.
   */
  protected constructor(code: ErrorCode, message: string, details?: ErrorDetails) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}
