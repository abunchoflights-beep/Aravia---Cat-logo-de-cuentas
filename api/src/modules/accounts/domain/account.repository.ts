import type { AccountCode } from './account-code.vo.js';
import type { Account } from './account.entity.js';

/** DI token for the {@link AccountRepository} port. */
export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');

/** Persistence port for the chart of accounts. */
export interface AccountRepository {
  /**
   * Lists every account in the catalog.
   *
   * @returns All accounts, in no particular order.
   */
  findAll(): Promise<ReadonlyArray<Account>>;

  /**
   * Finds one account by code.
   *
   * @param code - Account code.
   * @returns The account, or `null` when it does not exist.
   */
  findByCode(code: AccountCode): Promise<Account | null>;

  /**
   * Checks whether any account has `code` as its direct parent.
   *
   * @param code - Parent code.
   * @returns `true` when at least one child exists.
   */
  hasChildren(code: AccountCode): Promise<boolean>;

  /**
   * Inserts or replaces an account.
   *
   * @param account - Account to persist.
   */
  save(account: Account): Promise<void>;

  /**
   * Removes an account. No-op when it does not exist.
   *
   * @param code - Code of the account to remove.
   */
  delete(code: AccountCode): Promise<void>;
}
