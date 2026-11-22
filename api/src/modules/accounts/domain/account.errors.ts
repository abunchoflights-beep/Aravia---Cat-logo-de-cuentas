import { DomainException } from '../../../shared/domain/domain.exception.js';
import { ERROR_CODES } from '../../../shared/domain/error-code.js';
import { natureLabel, type AccountNature } from './account-nature.js';

/** Thrown when a code is not numeric or its length does not map to a level (1, 2, 4 or 6). */
export class InvalidAccountCodeError extends DomainException {
  /**
   * Creates the error.
   *
   * @param code - The rejected raw code.
   */
  constructor(code: string) {
    super(
      ERROR_CODES.CODIGO_CUENTA_INVALIDO,
      `El código "${code}" no es válido. Debe tener solo dígitos y una longitud de 1, 2, 4 o 6.`,
      { campo: 'codigo', valor: code },
    );
  }
}

/** Thrown when an account name is blank or exceeds the maximum length. */
export class InvalidAccountNameError extends DomainException {
  /**
   * Creates the error.
   *
   * @param maxLength - Maximum allowed length.
   */
  constructor(maxLength: number) {
    super(
      ERROR_CODES.NOMBRE_CUENTA_INVALIDO,
      `El nombre de la cuenta debe tener entre 1 y ${maxLength} caracteres.`,
      { campo: 'nombre' },
    );
  }
}

/** Thrown when an account looked up by code does not exist. */
export class AccountNotFoundError extends DomainException {
  /**
   * Creates the error.
   *
   * @param code - The missing account code.
   */
  constructor(code: string) {
    super(ERROR_CODES.CUENTA_NO_ENCONTRADA, `No se encontró la cuenta con el código "${code}".`, {
      campo: 'codigo',
      valor: code,
    });
  }
}

/** Thrown when creating an account whose derived parent does not exist (rule R4). */
export class ParentAccountNotFoundError extends DomainException {
  /**
   * Creates the error.
   *
   * @param code - Code of the account being created.
   * @param parentCode - Derived parent code that is missing.
   */
  constructor(code: string, parentCode: string) {
    super(
      ERROR_CODES.CUENTA_PADRE_NO_ENCONTRADA,
      `La cuenta padre "${parentCode}" no existe. Créala antes de crear la cuenta "${code}".`,
      { campo: 'codigo', valor: code, codigoPadre: parentCode },
    );
  }
}

/** Thrown when creating an account with a code already present in the catalog (rule R7). */
export class DuplicateAccountCodeError extends DomainException {
  /**
   * Creates the error.
   *
   * @param code - The duplicated code.
   */
  constructor(code: string) {
    super(
      ERROR_CODES.CODIGO_CUENTA_DUPLICADO,
      `Ya existe una cuenta registrada con el código "${code}".`,
      { campo: 'codigo', valor: code },
    );
  }
}

/** Thrown when deleting an account that still has child accounts (rule R5). */
export class AccountHasChildrenError extends DomainException {
  /**
   * Creates the error.
   *
   * @param code - Code of the account that cannot be deleted.
   */
  constructor(code: string) {
    super(
      ERROR_CODES.CUENTA_CON_CUENTAS_HIJAS,
      `No se puede eliminar la cuenta "${code}" porque tiene cuentas hijas.`,
      { campo: 'codigo', valor: code },
    );
  }
}

/** Thrown when a class is created without a nature (rule R8). */
export class AccountNatureRequiredError extends DomainException {
  /** Creates the error. */
  constructor() {
    super(
      ERROR_CODES.NATURALEZA_CUENTA_REQUERIDA,
      'Las cuentas de nivel clase deben indicar su naturaleza (débito o crédito).',
      { campo: 'naturaleza' },
    );
  }
}

/** Thrown when a descendant is given a nature different from the one it inherits (rule R8). */
export class IncompatibleAccountNatureError extends DomainException {
  /**
   * Creates the error.
   *
   * @param code - Code of the account being created.
   * @param inherited - Nature inherited from the parent.
   * @param requested - Nature that was requested.
   */
  constructor(code: string, inherited: AccountNature, requested: AccountNature) {
    super(
      ERROR_CODES.NATURALEZA_CUENTA_INCOMPATIBLE,
      `La naturaleza de la cuenta no es compatible con la de su cuenta padre: "${code}" hereda la naturaleza ${natureLabel(inherited)}.`,
      { campo: 'naturaleza', valor: requested },
    );
  }
}
