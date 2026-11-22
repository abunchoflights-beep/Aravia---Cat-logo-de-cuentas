import { AccountCode } from './account-code.vo.js';
import { ACCOUNT_NATURES } from './account-nature.js';
import { Account } from './account.entity.js';
import {
  AccountNatureRequiredError,
  IncompatibleAccountNatureError,
  InvalidAccountNameError,
} from './account.errors.js';

describe('Account', () => {
  const asset = Account.createClass(AccountCode.from('1'), 'Activo', ACCOUNT_NATURES.DEBIT);

  describe('createClass', () => {
    it('creates a class with its own nature and a trimmed name (R1, R8)', () => {
      const liability = Account.createClass(
        AccountCode.from('2'),
        '  Pasivo  ',
        ACCOUNT_NATURES.CREDIT,
      );

      expect(liability.code.value).toBe('2');
      expect(liability.name).toBe('Pasivo');
      expect(liability.level).toBe('clase');
      expect(liability.nature).toBe('credito');
    });

    it('requires a nature with NATURALEZA_CUENTA_REQUERIDA (R8)', () => {
      const act = (): Account =>
        Account.createClass(AccountCode.from('3'), 'Patrimonio', undefined);

      expect(act).toThrow(AccountNatureRequiredError);
      expect(act).toThrow(
        'Las cuentas de nivel clase deben indicar su naturaleza (débito o crédito).',
      );
    });

    it('refuses non-class codes as a programming error', () => {
      expect(() =>
        Account.createClass(AccountCode.from('11'), 'Disponible', ACCOUNT_NATURES.DEBIT),
      ).toThrow(TypeError);
    });
  });

  describe('createChild', () => {
    it('inherits the parent nature when none is requested (R8)', () => {
      const group = Account.createChild(AccountCode.from('11'), 'Disponible', asset);

      expect(group.nature).toBe('debito');
      expect(group.level).toBe('grupo');
    });

    it('accepts a requested nature equal to the inherited one', () => {
      const group = Account.createChild(
        AccountCode.from('11'),
        'Disponible',
        asset,
        ACCOUNT_NATURES.DEBIT,
      );

      expect(group.nature).toBe('debito');
    });

    it('rejects a different nature with NATURALEZA_CUENTA_INCOMPATIBLE (R8)', () => {
      const act = (): Account =>
        Account.createChild(AccountCode.from('11'), 'Disponible', asset, ACCOUNT_NATURES.CREDIT);

      expect(act).toThrow(IncompatibleAccountNatureError);
      expect(act).toThrow(
        'La naturaleza de la cuenta no es compatible con la de su cuenta padre: "11" hereda la naturaleza débito.',
      );
    });

    it('refuses a parent that is not the derived parent as a programming error', () => {
      expect(() => Account.createChild(AccountCode.from('1105'), 'Caja', asset)).toThrow(TypeError);
    });
  });

  describe('name rules', () => {
    it.each(['', '   ', 'x'.repeat(121)])('rejects "%s" with NOMBRE_CUENTA_INVALIDO', (name) => {
      expect(() => Account.createChild(AccountCode.from('11'), name, asset)).toThrow(
        InvalidAccountNameError,
      );
    });

    it('accepts exactly 120 characters', () => {
      const name = 'x'.repeat(120);

      expect(Account.createChild(AccountCode.from('11'), name, asset).name).toBe(name);
    });
  });

  it('round-trips through a snapshot', () => {
    const group = Account.createChild(AccountCode.from('11'), 'Disponible', asset);

    const restored = Account.restore(group.toSnapshot());

    expect(restored.toSnapshot()).toEqual({ code: '11', name: 'Disponible', nature: 'debito' });
  });
});
