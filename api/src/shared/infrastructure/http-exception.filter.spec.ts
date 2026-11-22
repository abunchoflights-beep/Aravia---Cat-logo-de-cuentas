import { BadRequestException, Logger, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { AccountHasChildrenError } from '../../modules/accounts/domain/account.errors.js';
import { HttpExceptionFilter, type ErrorEnvelope } from './http-exception.filter.js';
import { RequestValidationException } from './request-validation.exception.js';

interface Captured {
  status?: number;
  body?: ErrorEnvelope;
}

function hostFor(captured: Captured, url = '/cuentas/1105'): ArgumentsHost {
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: ErrorEnvelope) {
      captured.body = body;
      return this;
    },
  };
  const request = { url, method: 'DELETE' };
  const http = { getRequest: () => request, getResponse: () => response };
  return { switchToHttp: () => http } as unknown as ArgumentsHost;
}

describe('HttpExceptionFilter', () => {
  const fixedNow = new Date('2026-11-21T23:22:39.000Z');
  const filter = new HttpExceptionFilter(() => fixedNow);

  it('maps a domain exception to its status and envelope', () => {
    const captured: Captured = {};

    filter.catch(new AccountHasChildrenError('1105'), hostFor(captured));

    expect(captured.status).toBe(409);
    expect(captured.body).toEqual({
      statusCode: 409,
      code: 'CUENTA_CON_CUENTAS_HIJAS',
      message: 'No se puede eliminar la cuenta "1105" porque tiene cuentas hijas.',
      details: { campo: 'codigo', valor: '1105' },
      timestamp: '2026-11-21T23:22:39.000Z',
      path: '/cuentas/1105',
    });
  });

  it('keeps field details of validation failures', () => {
    const captured: Captured = {};
    const details = [{ campo: 'nombre', mensaje: 'El nombre es obligatorio.' }];

    filter.catch(new RequestValidationException(details), hostFor(captured, '/cuentas'));

    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({ code: 'VALIDACION_ENTRADA_FALLIDA', details });
  });

  it('maps framework 404s to RECURSO_NO_ENCONTRADO and other 4xx to validation errors', () => {
    const notFound: Captured = {};
    const badRequest: Captured = {};

    filter.catch(new NotFoundException(), hostFor(notFound));
    filter.catch(new BadRequestException('Unexpected token'), hostFor(badRequest));

    expect(notFound.body).toMatchObject({ statusCode: 404, code: 'RECURSO_NO_ENCONTRADO' });
    expect(badRequest.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDACION_ENTRADA_FALLIDA',
      message: 'Los datos enviados no son válidos.',
    });
  });

  it('hides unexpected errors behind ERROR_INTERNO_SERVIDOR and logs them', () => {
    const captured: Captured = {};
    const logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    filter.catch(new Error('SQLITE_BUSY at /srv/db.sqlite'), hostFor(captured));

    expect(captured.status).toBe(500);
    expect(captured.body).toEqual({
      statusCode: 500,
      code: 'ERROR_INTERNO_SERVIDOR',
      message: 'Ocurrió un error interno inesperado. Inténtalo de nuevo más tarde.',
      timestamp: '2026-11-21T23:22:39.000Z',
      path: '/cuentas/1105',
    });
    expect(JSON.stringify(captured.body)).not.toContain('SQLITE');
    expect(logSpy).toHaveBeenCalledOnce();
    logSpy.mockRestore();
  });
});
