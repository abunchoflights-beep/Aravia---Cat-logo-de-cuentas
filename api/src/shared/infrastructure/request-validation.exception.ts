import { DomainException, type FieldErrorDetail } from '../domain/domain.exception.js';
import { ERROR_CODES } from '../domain/error-code.js';

/** Thrown at the HTTP edge when the request shape is invalid; carries one entry per field. */
export class RequestValidationException extends DomainException {
  /**
   * Creates the exception.
   *
   * @param fieldErrors - One Spanish message per invalid field.
   */
  constructor(fieldErrors: ReadonlyArray<FieldErrorDetail>) {
    super(
      ERROR_CODES.VALIDACION_ENTRADA_FALLIDA,
      'Los datos enviados no son válidos.',
      fieldErrors,
    );
  }
}
