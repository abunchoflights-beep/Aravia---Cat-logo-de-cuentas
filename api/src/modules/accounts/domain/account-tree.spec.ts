import { buildAccountTree, type AccountTreeNode } from './account-tree.js';
import { Account } from './account.entity.js';

function account(code: string, name: string, nature: 'debito' | 'credito' = 'debito'): Account {
  return Account.restore({ code, name, nature });
}

function shape(nodes: ReadonlyArray<AccountTreeNode>): unknown[] {
  return nodes.map((node) => ({
    code: node.account.code.value,
    leaf: node.acceptsMovements,
    children: shape(node.children),
  }));
}

describe('buildAccountTree', () => {
  it('nests accounts under their derived parents, ordered by code, regardless of input order', () => {
    // Arrange
    const accounts = [
      account('110510', 'Caja menor'),
      account('2', 'Pasivo', 'credito'),
      account('1105', 'Caja'),
      account('1', 'Activo'),
      account('110505', 'Caja general'),
      account('11', 'Disponible'),
    ];

    // Act
    const tree = buildAccountTree(accounts);

    // Assert
    expect(shape(tree)).toEqual([
      {
        code: '1',
        leaf: false,
        children: [
          {
            code: '11',
            leaf: false,
            children: [
              {
                code: '1105',
                leaf: false,
                children: [
                  { code: '110505', leaf: true, children: [] },
                  { code: '110510', leaf: true, children: [] },
                ],
              },
            ],
          },
        ],
      },
      { code: '2', leaf: true, children: [] },
    ]);
  });

  it('flags only leaves as accepting movements (R6)', () => {
    const [root] = buildAccountTree([account('1', 'Activo'), account('11', 'Disponible')]);

    expect(root.hasChildren).toBe(true);
    expect(root.acceptsMovements).toBe(false);
    expect(root.children[0].hasChildren).toBe(false);
    expect(root.children[0].acceptsMovements).toBe(true);
  });

  it('returns an empty forest for an empty catalog', () => {
    expect(buildAccountTree([])).toEqual([]);
  });

  it('surfaces orphans as roots instead of dropping them', () => {
    const tree = buildAccountTree([account('1105', 'Caja')]);

    expect(shape(tree)).toEqual([{ code: '1105', leaf: true, children: [] }]);
  });
});
