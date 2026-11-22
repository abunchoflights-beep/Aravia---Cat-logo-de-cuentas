import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainException, type ErrorDetails } from '../domain/domain.exception.js';
import { ERROR_CODES, type ErrorCode } from '../domain/error-code.js';

/** Uniform JSON body returned for every failed request. */
export interface ErrorEnvelope {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: ErrorDetails;
  readonly timestamp: string;
  readonly path: string;
}

/** HTTP status for each error code; the only place where domain failures meet HTTP. */
const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDACION_ENTRADA_FALLIDA: HttpStatus.BAD_REQUEST,
  CODIGO_CUENTA_INVALIDO: HttpStatus.UNPROCESSABLE_ENTITY,
  NOMBRE_CUENTA_INVALIDO: HttpStatus.UNPROCESSABLE_ENTITY,
  RECURSO_NO_ENCONTRADO: HttpStatus.NOT_FOUND,
  CUENTA_NO_ENCONTRADA: HttpStatus.NOT_FOUND,
  CUENTA_PADRE_NO_ENCONTRADA: HttpStatus.NOT_FOUND,
  CODIGO_CUENTA_DUPLICADO: HttpStatus.CONFLICT,
  CUENTA_CON_CUENTAS_HIJAS: HttpStatus.CONFLICT,
  NATURALEZA_CUENTA_REQUERIDA: HttpStatus.UNPROCESSABLE_ENTITY,
  NATURALEZA_CUENTA_INCOMPATIBLE: HttpStatus.UNPROCESSABLE_ENTITY,
  ERROR_PERSISTENCIA: HttpStatus.INTERNAL_SERVER_ERROR,
  ERROR_INTERNO_SERVIDOR: HttpStatus.INTERNAL_SERVER_ERROR,
};

type EnvelopeCore = Pick<ErrorEnvelope, 'statusCode' | 'code' | 'message' | 'details'>;

/**
 * Global filter that turns any thrown value into the Spanish error envelope.
 *
 * Unexpected errors are logged with their stack and answered with a generic message, so internal
 * details never reach the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly now: () => Date;

  /**
   * Creates the filter.
   *
   * @param now - Clock used for the envelope timestamp (injectable for tests).
   */
  constructor(now: () => Date = (): Date => new Date()) {
    this.now = now;
  }

  /**
   * Writes the error envelope to the HTTP response.
   *
   * @param exception - Whatever was thrown while handling the request.
   * @param host - Nest execution context.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const core = this.toCore(exception, request);
    const envelope: ErrorEnvelope = {
      ...core,
      timestamp: this.now().toISOString(),
      path: request.url,
    };
    response.status(envelope.statusCode).json(envelope);
  }

  private toCore(exception: unknown, request: Request): EnvelopeCore {
    if (exception instanceof DomainException) {
      return {
        statusCode: STATUS_BY_CODE[exception.code],
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === Number(HttpStatus.NOT_FOUND)) {
        return {
          statusCode: status,
          code: ERROR_CODES.RECURSO_NO_ENCONTRADO,
          message: 'No se encontró el recurso solicitado.',
        };
      }
      if (status >= 400 && status < 500) {
        // Framework-level client errors (malformed JSON, payload too large...) keep their status.
        return {
          statusCode: status,
          code: ERROR_CODES.VALIDACION_ENTRADA_FALLIDA,
          message: 'Los datos enviados no son válidos.',
        };
      }
    }

    const stack = exception instanceof Error ? exception.stack : String(exception);
    this.logger.error(`Error no controlado en ${request.method} ${request.url}`, stack);
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.ERROR_INTERNO_SERVIDOR,
      message: 'Ocurrió un error interno inesperado. Inténtalo de nuevo más tarde.',
    };
  }
}
