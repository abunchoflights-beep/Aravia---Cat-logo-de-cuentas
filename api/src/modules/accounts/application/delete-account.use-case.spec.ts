import { ERROR_CODES } from '../../../shared/domain/error-code.js';
import { FakeAccountRepository, SAMPLE_CATALOG } from '../testing/fake-account.repository.js';
import { DeleteAccountUseCase } from './delete-account.use-case.js';
import { ListAccountTreeUseCase } from './list-account-tree.use-case.js';

describe('DeleteAccountUseCase', () => {
  let repository: FakeAccountRepository;
  let useCase: DeleteAccountUseCase;

  beforeEach(() => {
    repository = new FakeAccountRepository(SAMPLE_CATALOG);
    useCase = new DeleteAccountUseCase(repository);
  });

  it('deletes a leaf account (AC3.1)', async () => {
    await useCase.execute('110510');

    expect(repository.codes()).not.toContain('110510');
    expect(repository.codes()).toContain('110505');
  });

  it('refuses to delete an account with children with CUENTA_CON_CUENTAS_HIJAS (AC3.2, R5)', async () => {
    await expect(useCase.execute('1105')).rejects.toMatchObject({
      code: ERROR_CODES.CUENTA_CON_CUENTAS_HIJAS,
      message: 'No se puede eliminar la cuenta "1105" porque tiene cuentas hijas.',
    });
    expect(repository.deleted).toHaveLength(0);
  });

  it('reports a missing account with CUENTA_NO_ENCONTRADA (AC3.3)', async () => {
    await expect(useCase.execute('9999')).rejects.toMatchObject({
      code: ERROR_CODES.CUENTA_NO_ENCONTRADA,
      message: 'No se encontró la cuenta con el código "9999".',
    });
  });

  it('rejects an invalid code with CODIGO_CUENTA_INVALIDO', async () => {
    await expect(useCase.execute('abc')).rejects.toMatchObject({
      code: ERROR_CODES.CODIGO_CUENTA_INVALIDO,
    });
  });

  it('turns the parent into a deletable leaf after removing its last child (AC3.5)', async () => {
    // Arrange
    await useCase.execute('2105');
    const tree = await new ListAccountTreeUseCase(repository).execute();
    const group = tree.find((n) => n.code === '2')?.children.find((n) => n.code === '21');

    // Assert
    expect(group).toMatchObject({ hasChildren: false, acceptsMovements: true, children: [] });
    await expect(useCase.execute('21')).resolves.toBeUndefined();
  });
});
