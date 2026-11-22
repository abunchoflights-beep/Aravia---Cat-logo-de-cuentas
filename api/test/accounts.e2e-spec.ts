import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/shared/infrastructure/configure-app.js';

interface Node {
  codigo: string;
  nombre: string;
  nivel: string;
  naturaleza: string;
  codigoPadre: string | null;
  tieneHijas: boolean;
  admiteMovimientos: boolean;
  hijas: Node[];
}

interface FieldDetail {
  campo: string;
  mensaje: string;
}

function findNode(nodes: Node[], code: string): Node | undefined {
  for (const node of nodes) {
    if (node.codigo === code) return node;
    const found = findNode(node.hijas, code);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe('/cuentas (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  async function tree(): Promise<Node[]> {
    const response = await request(app.getHttpServer()).get('/cuentas').expect(200);
    return response.body as Node[];
  }

  function expectEnvelope(
    body: Record<string, unknown>,
    statusCode: number,
    code: string,
    path: string,
  ): void {
    expect(body).toMatchObject({ statusCode, code, path });
    expect(typeof body.message).toBe('string');
    expect(new Date(body.timestamp as string).toISOString()).toBe(body.timestamp);
  }

  describe('GET /cuentas (H1)', () => {
    it('returns the seeded catalog as a tree ordered by code (AC1.1, AC1.2)', async () => {
      const roots = await tree();

      expect(roots.map((n) => n.codigo)).toEqual(['1', '2']);
      expect(roots[0]).toMatchObject({
        codigo: '1',
        nombre: 'Activo',
        nivel: 'clase',
        naturaleza: 'debito',
        codigoPadre: null,
        tieneHijas: true,
        admiteMovimientos: false,
      });
      expect(findNode(roots, '1105')?.hijas.map((n) => n.codigo)).toEqual(['110505', '110510']);
      expect(findNode(roots, '110505')).toEqual({
        codigo: '110505',
        nombre: 'Caja general',
        nivel: 'subcuenta',
        naturaleza: 'debito',
        codigoPadre: '1105',
        tieneHijas: false,
        admiteMovimientos: true,
        hijas: [],
      });
      expect(findNode(roots, '2105')).toMatchObject({ naturaleza: 'credito', nivel: 'cuenta' });
    });
  });

  describe('POST /cuentas (H2)', () => {
    it('creates a subaccount that inherits its nature (AC2.1)', async () => {
      const response = await request(app.getHttpServer())
        .post('/cuentas')
        .send({ codigo: '110515', nombre: 'Caja auxiliar' })
        .expect(201);

      expect(response.body).toEqual({
        codigo: '110515',
        nombre: 'Caja auxiliar',
        nivel: 'subcuenta',
        naturaleza: 'debito',
        codigoPadre: '1105',
        tieneHijas: false,
        admiteMovimientos: true,
        hijas: [],
      });
      expect(findNode(await tree(), '1105')?.hijas.map((n) => n.codigo)).toEqual([
        '110505',
        '110510',
        '110515',
      ]);
    });

    it('creates a class with its nature (AC2.2)', async () => {
      const response = await request(app.getHttpServer())
        .post('/cuentas')
        .send({ codigo: '3', nombre: 'Patrimonio', naturaleza: 'credito' })
        .expect(201);

      expect(response.body).toMatchObject({ codigoPadre: null, nivel: 'clase' });
    });

    it.each([
      [{ nombre: 'X' }, 'El código es obligatorio.'],
      [{ codigo: 1105, nombre: 'X' }, 'El código es obligatorio.'],
      [
        { codigo: '11a5', nombre: 'X' },
        'El código debe tener solo dígitos y una longitud de 1, 2, 4 o 6.',
      ],
      [
        { codigo: '123', nombre: 'X' },
        'El código debe tener solo dígitos y una longitud de 1, 2, 4 o 6.',
      ],
    ])('rejects invalid codigo %j with a field error (AC2.3)', async (body, mensaje) => {
      const response = await request(app.getHttpServer()).post('/cuentas').send(body).expect(400);

      expectEnvelope(
        response.body as Record<string, unknown>,
        400,
        'VALIDACION_ENTRADA_FALLIDA',
        '/cuentas',
      );
      expect(response.body.message).toBe('Los datos enviados no son válidos.');
      expect(response.body.details).toEqual([{ campo: 'codigo', mensaje }]);
    });

    it.each([
      [{ codigo: '1110' }, 'El nombre es obligatorio.'],
      [{ codigo: '1110', nombre: '    ' }, 'El nombre es obligatorio.'],
      [
        { codigo: '1110', nombre: 'x'.repeat(121) },
        'El nombre no puede superar los 120 caracteres.',
      ],
    ])('rejects invalid nombre %j with a field error (AC2.4)', async (body, mensaje) => {
      const response = await request(app.getHttpServer()).post('/cuentas').send(body).expect(400);

      expect(response.body.details).toEqual([{ campo: 'nombre', mensaje }]);
    });

    it('rejects an unknown naturaleza (AC2.5)', async () => {
      const response = await request(app.getHttpServer())
        .post('/cuentas')
        .send({ codigo: '3', nombre: 'Patrimonio', naturaleza: 'mixta' })
        .expect(400);

      expect(response.body.details).toEqual([
        { campo: 'naturaleza', mensaje: 'La naturaleza debe ser "debito" o "credito".' },
      ]);
    });

    it('rejects unknown properties (AC2.6)', async () => {
      const response = await request(app.getHttpServer())
        .post('/cuentas')
        .send({ codigo: '1110', nombre: 'Bancos', codigoPadre: '11' })
        .expect(400);

      expect(response.body.details).toEqual([
        { campo: 'codigoPadre', mensaje: 'La propiedad "codigoPadre" no está permitida.' },
      ]);
    });

    it('reports every invalid field at once', async () => {
      const response = await request(app.getHttpServer()).post('/cuentas').send({}).expect(400);

      const campos = (response.body.details as FieldDetail[]).map((d) => d.campo).sort();
      expect(campos).toEqual(['codigo', 'nombre']);
    });

    it('rejects a duplicated code with 409 CODIGO_CUENTA_DUPLICADO (AC2.7)', async () => {
      const response = await request(app.getHttpServer())
        .post('/cuentas')
        .send({ codigo: '1105', nombre: 'Otra caja' })
        .expect(409);

      expectEnvelope(
        response.body as Record<string, unknown>,
        409,
        'CODIGO_CUENTA_DUPLICADO',
        '/cuentas',
      );
      expect(response.body.message).toBe('Ya existe una cuenta registrada con el código "1105".');
      expect(response.body.details).toEqual({ campo: 'codigo', valor: '1105' });
    });

    it('rejects a missing parent with 404 CUENTA_PADRE_NO_ENCONTRADA (AC2.8)', async () => {
      const response = await request(app.getHttpServer())
        .post('/cuentas')
        .send({ codigo: '9905', nombre: 'Huérfana' })
        .expect(404);

      expect(response.body).toMatchObject({
        code: 'CUENTA_PADRE_NO_ENCONTRADA',
        message: 'La cuenta padre "99" no existe. Créala antes de crear la cuenta "9905".',
        details: { campo: 'codigo', valor: '9905', codigoPadre: '99' },
      });
    });

    it('requires a nature for classes with 422 NATURALEZA_CUENTA_REQUERIDA (AC2.9)', async () => {
      const response = await request(app.getHttpServer())
        .post('/cuentas')
        .send({ codigo: '3', nombre: 'Patrimonio' })
        .expect(422);

      expect(response.body).toMatchObject({
        code: 'NATURALEZA_CUENTA_REQUERIDA',
        details: { campo: 'naturaleza' },
      });
    });

    it('rejects an incompatible nature with 422 NATURALEZA_CUENTA_INCOMPATIBLE (AC2.10)', async () => {
      const response = await request(app.getHttpServer())
        .post('/cuentas')
        .send({ codigo: '2110', nombre: 'Bancos del exterior', naturaleza: 'debito' })
        .expect(422);

      expect(response.body).toMatchObject({
        code: 'NATURALEZA_CUENTA_INCOMPATIBLE',
        details: { campo: 'naturaleza', valor: 'debito' },
      });
    });

    it('answers malformed JSON with the Spanish envelope', async () => {
      const response = await request(app.getHttpServer())
        .post('/cuentas')
        .set('Content-Type', 'application/json')
        .send('{"codigo":')
        .expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDACION_ENTRADA_FALLIDA' });
    });
  });

  describe('DELETE /cuentas/:codigo (H3)', () => {
    it('deletes a leaf account with 204 (AC3.1)', async () => {
      await request(app.getHttpServer()).delete('/cuentas/110510').expect(204).expect('');

      const roots = await tree();
      expect(findNode(roots, '110510')).toBeUndefined();
      expect(findNode(roots, '1105')?.hijas.map((n) => n.codigo)).toEqual(['110505']);
    });

    it('refuses to delete an account with children with 409 (AC3.2)', async () => {
      const response = await request(app.getHttpServer()).delete('/cuentas/1105').expect(409);

      expectEnvelope(
        response.body as Record<string, unknown>,
        409,
        'CUENTA_CON_CUENTAS_HIJAS',
        '/cuentas/1105',
      );
      expect(response.body.message).toBe(
        'No se puede eliminar la cuenta "1105" porque tiene cuentas hijas.',
      );
      expect(findNode(await tree(), '1105')).toBeDefined();
    });

    it('reports a missing account with 404 CUENTA_NO_ENCONTRADA (AC3.3)', async () => {
      const response = await request(app.getHttpServer()).delete('/cuentas/9999').expect(404);

      expect(response.body).toMatchObject({
        code: 'CUENTA_NO_ENCONTRADA',
        message: 'No se encontró la cuenta con el código "9999".',
      });
    });

    it.each(['abc', '123'])('rejects the invalid path code "%s" with 400 (AC3.4)', async (code) => {
      const response = await request(app.getHttpServer()).delete(`/cuentas/${code}`).expect(400);

      expect(response.body).toMatchObject({
        code: 'VALIDACION_ENTRADA_FALLIDA',
        details: [
          {
            campo: 'codigo',
            mensaje: 'El código debe tener solo dígitos y una longitud de 1, 2, 4 o 6.',
          },
        ],
      });
    });

    it('turns the parent into a deletable leaf after deleting its last child (AC3.5)', async () => {
      await request(app.getHttpServer()).delete('/cuentas/2105').expect(204);

      expect(findNode(await tree(), '21')).toMatchObject({
        tieneHijas: false,
        admiteMovimientos: true,
      });
      await request(app.getHttpServer()).delete('/cuentas/21').expect(204);
    });
  });

  it('answers unknown routes with 404 RECURSO_NO_ENCONTRADO', async () => {
    const response = await request(app.getHttpServer()).get('/no-existe').expect(404);

    expect(response.body).toMatchObject({ code: 'RECURSO_NO_ENCONTRADO', path: '/no-existe' });
  });
});
