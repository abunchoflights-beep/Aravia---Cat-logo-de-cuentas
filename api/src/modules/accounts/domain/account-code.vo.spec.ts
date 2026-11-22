import { AccountCode } from './account-code.vo.js';
import { ACCOUNT_LEVELS } from './account-level.js';
import { InvalidAccountCodeError } from './account.errors.js';

describe('AccountCode', () => {
  it.each([
    ['1', ACCOUNT_LEVELS.CLASS],
    ['11', ACCOUNT_LEVELS.GROUP],
    ['1105', ACCOUNT_LEVELS.ACCOUNT],
    ['110505', ACCOUNT_LEVELS.SUBACCOUNT],
  ])('derives the level of "%s" from its length (R2)', (raw, level) => {
    // Act
    const code = AccountCode.from(raw);

    // Assert
    expect(code.value).toBe(raw);
    expect(code.level).toBe(level);
  });

  it.each([
    ['110505', '1105'],
    ['1105', '11'],
    ['11', '1'],
  ])('derives the parent of "%s" as "%s" (R3)', (raw, parent) => {
    expect(AccountCode.from(raw).parentCode()?.value).toBe(parent);
  });

  it('gives classes no parent (R3)', () => {
    const code = AccountCode.from('1');

    expect(code.isClass).toBe(true);
    expect(code.parentCode()).toBeNull();
  });

  it.each(['', '123', '12345', '1234567', 'abc', '11a5', ' 1', '1.5', '-1'])(
    'rejects "%s" with CODIGO_CUENTA_INVALIDO (R1, R2)',
    (raw) => {
      // Act
      const act = (): AccountCode => AccountCode.from(raw);

      // Assert
      expect(act).toThrow(InvalidAccountCodeError);
      expect(AccountCode.isValid(raw)).toBe(false);
    },
  );

  it('exposes a Spanish message and the field in the error', () => {
    try {
      AccountCode.from('123');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidAccountCodeError);
      const domainError = error as InvalidAccountCodeError;
      expect(domainError.code).toBe('CODIGO_CUENTA_INVALIDO');
      expect(domainError.message).toBe(
        'El código "123" no es válido. Debe tener solo dígitos y una longitud de 1, 2, 4 o 6.',
      );
      expect(domainError.details).toEqual({ campo: 'codigo', valor: '123' });
    }
  });

  it('recognizes direct children only', () => {
    const group = AccountCode.from('11');

    expect(group.isParentOf(AccountCode.from('1105'))).toBe(true);
    expect(group.isParentOf(AccountCode.from('110505'))).toBe(false);
    expect(group.isParentOf(AccountCode.from('1205'))).toBe(false);
  });

  it('compares by value', () => {
    expect(AccountCode.from('11').equals(AccountCode.from('11'))).toBe(true);
    expect(AccountCode.from('11').equals(AccountCode.from('12'))).toBe(false);
  });
});
