import { AccountCode } from '../domain/account-code.vo.js';
import { AccountHasChildrenError, AccountNotFoundError } from '../domain/account.errors.js';
import type { AccountRepository } from '../domain/account.repository.js';

/** Deletes a leaf account from the catalog. */
export class DeleteAccountUseCase {
  private readonly accounts: AccountRepository;

  /**
   * Creates the use case.
   *
   * @param accounts - Account persistence port.
   */
  constructor(accounts: AccountRepository) {
    this.accounts = accounts;
  }

  /**
   * Deletes the account identified by `rawCode`.
   *
   * @param rawCode - Code of the account to delete.
   * @throws {InvalidAccountCodeError} When the code is not a valid account code.
   * @throws {AccountNotFoundError} When the account does not exist.
   * @throws {AccountHasChildrenError} When the account still has child accounts (R5).
   */
  async execute(rawCode: string): Promise<void> {
    const code = AccountCode.from(rawCode);

    if ((await this.accounts.findByCode(code)) === null) {
      throw new AccountNotFoundError(code.value);
    }
    if (await this.accounts.hasChildren(code)) {
      throw new AccountHasChildrenError(code.value);
    }

    await this.accounts.delete(code);
  }
}
