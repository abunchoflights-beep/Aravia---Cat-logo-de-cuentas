import { ERROR_CODES } from '../../../shared/domain/error-code.js';
import { DomainException } from '../../../shared/domain/domain.exception.js';
import { FakeAccountRepository, SAMPLE_CATALOG } from '../testing/fake-account.repository.js';
import type { CreateAccountInput } from './account.dto.js';
import { CreateAccountUseCase } from './create-account.use-case.js';

async function captureError(promise: Promise<unknown>): Promise<DomainException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainException) return error;
    throw error;
  }
  throw new Error('Se esperaba un error de dominio.');
}

describe('CreateAccountUseCase', () => {
  let repository: FakeAccountRepository;
  let useCase: CreateAccountUseCase;

  beforeEach(() => {
    repository = new FakeAccountRepository(SAMPLE_CATALOG);
    useCase = new CreateAccountUseCase(repository);
  });

  it('creates a subaccount under an existing parent, inheriting its nature (AC2.1, R8)', async () => {
    // Act
    const created = await useCase.execute({ code: '110515', name: '  Caja auxiliar ' });

    // Assert
    expect(created).toEqual({
      code: '110515',
      name: 'Caja auxiliar',
      level: 'subcuenta',
      nature: 'debito',
      parentCode: '1105',
      hasChildren: false,
      acceptsMovements: true,
      children: [],
    });
    expect(repository.codes()).toContain('110515');
  });

  it('creates a new class with its nature (AC2.2)', async () => {
    const created = await useCase.execute({ code: '3', name: 'Patrimonio', nature: 'credito' });

    expect(created.level).toBe('clase');
    expect(created.parentCode).toBeNull();
    expect(created.nature).toBe('credito');
  });

  it('rejects a duplicated code with CODIGO_CUENTA_DUPLICADO and writes nothing (AC2.7, R7)', async () => {
    const error = await captureError(useCase.execute({ code: '1105', name: 'Otra caja' }));

    expect(error.code).toBe(ERROR_CODES.CODIGO_CUENTA_DUPLICADO);
    expect(error.message).toBe('Ya existe una cuenta registrada con el código "1105".');
    expect(error.details).toEqual({ campo: 'codigo', valor: '1105' });
    expect(repository.saved).toHaveLength(0);
  });

  it('rejects a missing parent with CUENTA_PADRE_NO_ENCONTRADA (AC2.8, R4)', async () => {
    const error = await captureError(useCase.execute({ code: '9905', name: 'Huérfana' }));

    expect(error.code).toBe(ERROR_CODES.CUENTA_PADRE_NO_ENCONTRADA);
    expect(error.message).toBe(
      'La cuenta padre "99" no existe. Créala antes de crear la cuenta "9905".',
    );
    expect(repository.saved).toHaveLength(0);
  });

  it('only checks the immediate parent, not distant ancestors (R3)', async () => {
    // "1110" has parent "11" which exists; its grandparent "1" also exists.
    await expect(useCase.execute({ code: '1110', name: 'Bancos' })).resolves.toMatchObject({
      parentCode: '11',
    });
    // "110605" has parent "1106" which does not exist, even though "11" does.
    const error = await captureError(useCase.execute({ code: '110605', name: 'X' }));
    expect(error.code).toBe(ERROR_CODES.CUENTA_PADRE_NO_ENCONTRADA);
  });

  it('requires a nature for classes with NATURALEZA_CUENTA_REQUERIDA (AC2.9)', async () => {
    const error = await captureError(useCase.execute({ code: '3', name: 'Patrimonio' }));

    expect(error.code).toBe(ERROR_CODES.NATURALEZA_CUENTA_REQUERIDA);
    expect(error.details).toEqual({ campo: 'naturaleza' });
  });

  it('rejects a nature different from the parent with NATURALEZA_CUENTA_INCOMPATIBLE (AC2.10)', async () => {
    const input: CreateAccountInput = {
      code: '2110',
      name: 'Bancos del exterior',
      nature: 'debito',
    };

    const error = await captureError(useCase.execute(input));

    expect(error.code).toBe(ERROR_CODES.NATURALEZA_CUENTA_INCOMPATIBLE);
    expect(error.details).toEqual({ campo: 'naturaleza', valor: 'debito' });
  });

  it('rejects an invalid code with CODIGO_CUENTA_INVALIDO', async () => {
    const error = await captureError(useCase.execute({ code: '123', name: 'X' }));

    expect(error.code).toBe(ERROR_CODES.CODIGO_CUENTA_INVALIDO);
  });

  it('rejects a blank name with NOMBRE_CUENTA_INVALIDO', async () => {
    const error = await captureError(useCase.execute({ code: '1110', name: '   ' }));

    expect(error.code).toBe(ERROR_CODES.NOMBRE_CUENTA_INVALIDO);
  });
});
