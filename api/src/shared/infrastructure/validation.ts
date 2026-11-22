import { ValidationPipe, type ValidationError } from '@nestjs/common';
import type { FieldErrorDetail } from '../domain/domain.exception.js';
import { RequestValidationException } from './request-validation.exception.js';

/**
 * Constraint precedence when a field fails several rules: report the most fundamental problem
 * first (missing before malformed), so users fix one thing at a time.
 */
const CONSTRAINT_PRIORITY: ReadonlyArray<string> = [
  'whitelistValidation',
  'isDefined',
  'isString',
  'isNotEmpty',
  'matches',
  'maxLength',
  'isIn',
];

/**
 * Converts class-validator errors into one Spanish message per field.
 *
 * @param errors - Errors produced by class-validator.
 * @returns Field errors ready for the error envelope.
 */
export function toFieldErrors(errors: ReadonlyArray<ValidationError>): FieldErrorDetail[] {
  return errors.flatMap((error) => {
    const constraints = error.constraints ?? {};
    const keys = Object.keys(constraints);
    if (keys.length === 0) {
      return [];
    }
    const ranked = [...keys].sort((a, b) => rank(a) - rank(b));
    const winner = ranked[0];
    const mensaje =
      winner === 'whitelistValidation'
        ? `La propiedad "${error.property}" no está permitida.`
        : constraints[winner];
    return [{ campo: error.property, mensaje }];
  });
}

function rank(constraint: string): number {
  const index = CONSTRAINT_PRIORITY.indexOf(constraint);
  return index === -1 ? CONSTRAINT_PRIORITY.length : index;
}

/**
 * Builds the global validation pipe: strips nothing silently, rejects unknown properties, and
 * reports failures as `VALIDACION_ENTRADA_FALLIDA` with Spanish field messages.
 *
 * @returns The configured pipe.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]): RequestValidationException =>
      new RequestValidationException(toFieldErrors(errors)),
  });
}
