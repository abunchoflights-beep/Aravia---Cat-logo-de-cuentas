import { FakeAccountRepository, SAMPLE_CATALOG } from '../testing/fake-account.repository.js';
import { ListAccountTreeUseCase } from './list-account-tree.use-case.js';

describe('ListAccountTreeUseCase', () => {
  it('returns the classes as roots with nested descendants (AC1.1, AC1.2)', async () => {
    // Arrange
    const useCase = new ListAccountTreeUseCase(new FakeAccountRepository(SAMPLE_CATALOG));

    // Act
    const tree = await useCase.execute();

    // Assert
    expect(tree.map((n) => n.code)).toEqual(['1', '2']);
    const cash = tree[0].children[0].children[0];
    expect(cash).toMatchObject({
      code: '1105',
      name: 'Caja',
      level: 'cuenta',
      nature: 'debito',
      parentCode: '11',
      hasChildren: true,
      acceptsMovements: false,
    });
    expect(cash.children.map((n) => n.code)).toEqual(['110505', '110510']);
    expect(cash.children[0]).toMatchObject({
      level: 'subcuenta',
      acceptsMovements: true,
      children: [],
    });
    expect(tree[1]).toMatchObject({ code: '2', nature: 'credito', parentCode: null });
  });

  it('returns an empty list for an empty catalog', async () => {
    const useCase = new ListAccountTreeUseCase(new FakeAccountRepository());

    await expect(useCase.execute()).resolves.toEqual([]);
  });
});
