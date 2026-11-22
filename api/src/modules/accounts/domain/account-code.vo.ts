import { LEVEL_CODE_LENGTHS, type AccountLevel } from './account-level.js';
import { InvalidAccountCodeError } from './account.errors.js';

const DIGITS_ONLY = /^\d+$/;

/**
 * Numeric account code. Its length defines the hierarchy level and its prefix defines the parent.
 *
 * Immutable; two codes are equal when their string values are equal.
 */
export class AccountCode {
  /** Raw digits, e.g. `"110505"`. */
  readonly value: string;
  /** Hierarchy level derived from the code length. */
  readonly level: AccountLevel;
  private readonly levelIndex: number;

  private constructor(value: string, levelIndex: number) {
    this.value = value;
    this.levelIndex = levelIndex;
    this.level = LEVEL_CODE_LENGTHS[levelIndex].level;
  }

  /**
   * Parses and validates a raw code.
   *
   * @param raw - Untrusted code string.
   * @returns The validated code.
   * @throws {InvalidAccountCodeError} When the code is not numeric or its length is not 1, 2, 4 or 6.
   */
  static from(raw: string): AccountCode {
    const levelIndex = LEVEL_CODE_LENGTHS.findIndex((entry) => entry.length === raw.length);
    if (!DIGITS_ONLY.test(raw) || levelIndex === -1) {
      throw new InvalidAccountCodeError(raw);
    }
    return new AccountCode(raw, levelIndex);
  }

  /**
   * Checks whether a raw string is a valid account code without throwing.
   *
   * @param raw - Untrusted code string.
   * @returns `true` when {@link AccountCode.from} would succeed.
   */
  static isValid(raw: string): boolean {
    return DIGITS_ONLY.test(raw) && LEVEL_CODE_LENGTHS.some((entry) => entry.length === raw.length);
  }

  /** Whether this code is a class (top level, no parent). */
  get isClass(): boolean {
    return this.levelIndex === 0;
  }

  /**
   * Derives the parent code: the prefix whose length is the previous level's length.
   *
   * @returns The parent code, or `null` for classes.
   */
  parentCode(): AccountCode | null {
    if (this.isClass) {
      return null;
    }
    const parentLength = LEVEL_CODE_LENGTHS[this.levelIndex - 1].length;
    return new AccountCode(this.value.slice(0, parentLength), this.levelIndex - 1);
  }

  /**
   * Checks whether `other` is a direct child of this code.
   *
   * @param other - Candidate child code.
   * @returns `true` when the parent of `other` equals this code.
   */
  isParentOf(other: AccountCode): boolean {
    return other.parentCode()?.equals(this) ?? false;
  }

  /**
   * Compares two codes by value.
   *
   * @param other - Code to compare with.
   * @returns `true` when both codes have the same digits.
   */
  equals(other: AccountCode): boolean {
    return this.value === other.value;
  }
}
