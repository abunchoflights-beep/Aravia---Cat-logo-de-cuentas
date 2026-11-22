import { AccountCode } from './account-code.vo.js';
import type { AccountLevel } from './account-level.js';
import type { AccountNature } from './account-nature.js';
import {
  AccountNatureRequiredError,
  IncompatibleAccountNatureError,
  InvalidAccountNameError,
} from './account.errors.js';

/** Maximum length of an account name after trimming. */
export const ACCOUNT_NAME_MAX_LENGTH = 120;

/** Persisted state needed to rebuild an {@link Account} without re-running creation rules. */
export interface AccountSnapshot {
  readonly code: string;
  readonly name: string;
  readonly nature: AccountNature;
}

/**
 * One account of the chart of accounts.
 *
 * Construction goes through factories so that nature inheritance (R8) is enforced at creation time.
 */
export class Account {
  /** Unique code; also defines level and parent. */
  readonly code: AccountCode;
  /** Trimmed display name. */
  readonly name: string;
  /** Nature of the account's class, inherited by every descendant. */
  readonly nature: AccountNature;

  private constructor(code: AccountCode, name: string, nature: AccountNature) {
    this.code = code;
    this.name = name;
    this.nature = nature;
  }

  /**
   * Creates a top-level class with its own nature.
   *
   * @param code - A class-level code (1 digit).
   * @param name - Raw name; trimmed before validation.
   * @param nature - Nature of the class; mandatory.
   * @returns The new class.
   * @throws {AccountNatureRequiredError} When `nature` is missing.
   * @throws {InvalidAccountNameError} When the name is blank or too long.
   */
  static createClass(code: AccountCode, name: string, nature: AccountNature | undefined): Account {
    if (!code.isClass) {
      // Programming error: callers must route non-classes through createChild.
      throw new TypeError(`El código ${code.value} no corresponde a una clase.`);
    }
    if (nature === undefined) {
      throw new AccountNatureRequiredError();
    }
    return new Account(code, Account.normalizeName(name), nature);
  }

  /**
   * Creates a descendant account that inherits its parent's nature.
   *
   * @param code - Non-class code whose parent is `parent`.
   * @param name - Raw name; trimmed before validation.
   * @param parent - Existing parent account.
   * @param requestedNature - Optional nature sent by the client; must match the inherited one.
   * @returns The new account.
   * @throws {IncompatibleAccountNatureError} When `requestedNature` differs from the parent's.
   * @throws {InvalidAccountNameError} When the name is blank or too long.
   */
  static createChild(
    code: AccountCode,
    name: string,
    parent: Account,
    requestedNature?: AccountNature,
  ): Account {
    if (!parent.code.isParentOf(code)) {
      // Programming error: the use case derives the parent from the code.
      throw new TypeError(`La cuenta ${parent.code.value} no es padre de ${code.value}.`);
    }
    if (requestedNature !== undefined && requestedNature !== parent.nature) {
      throw new IncompatibleAccountNatureError(code.value, parent.nature, requestedNature);
    }
    return new Account(code, Account.normalizeName(name), parent.nature);
  }

  /**
   * Rebuilds an account from persisted state.
   *
   * @param snapshot - Previously persisted state.
   * @returns The rehydrated account.
   * @throws {InvalidAccountCodeError} When the stored code is corrupt.
   * @throws {InvalidAccountNameError} When the stored name is corrupt.
   */
  static restore(snapshot: AccountSnapshot): Account {
    return new Account(
      AccountCode.from(snapshot.code),
      Account.normalizeName(snapshot.name),
      snapshot.nature,
    );
  }

  /** Hierarchy level derived from the code. */
  get level(): AccountLevel {
    return this.code.level;
  }

  /**
   * Exports the persistable state of the account.
   *
   * @returns A plain snapshot.
   */
  toSnapshot(): AccountSnapshot {
    return { code: this.code.value, name: this.name, nature: this.nature };
  }

  private static normalizeName(raw: string): string {
    const name = raw.trim();
    if (name.length === 0 || name.length > ACCOUNT_NAME_MAX_LENGTH) {
      throw new InvalidAccountNameError(ACCOUNT_NAME_MAX_LENGTH);
    }
    return name;
  }
}
