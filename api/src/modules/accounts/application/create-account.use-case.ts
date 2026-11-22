import { AccountCode } from '../domain/account-code.vo.js';
import { Account } from '../domain/account.entity.js';
import { DuplicateAccountCodeError, ParentAccountNotFoundError } from '../domain/account.errors.js';
import type { AccountRepository } from '../domain/account.repository.js';
import { toAccountNodeOutput } from './account-node.mapper.js';
import type { AccountNodeOutput, CreateAccountInput } from './account.dto.js';

/** Creates one account in the catalog, enforcing uniqueness, parent existence and nature rules. */
export class CreateAccountUseCase {
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
   * Validates and persists a new account.
   *
   * @param input - Code, name and optional nature.
   * @returns The created account as a leaf node.
   * @throws {InvalidAccountCodeError} When the code is not numeric or has an invalid length.
   * @throws {DuplicateAccountCodeError} When the code already exists (R7).
   * @throws {ParentAccountNotFoundError} When the derived parent does not exist (R4).
   * @throws {AccountNatureRequiredError} When a class is created without nature (R8).
   * @throws {IncompatibleAccountNatureError} When a descendant requests a different nature (R8).
   * @throws {InvalidAccountNameError} When the name is blank or too long.
   */
  async execute(input: CreateAccountInput): Promise<AccountNodeOutput> {
    const code = AccountCode.from(input.code);

    if ((await this.accounts.findByCode(code)) !== null) {
      throw new DuplicateAccountCodeError(code.value);
    }

    const account = await this.buildAccount(code, input);
    await this.accounts.save(account);

    // A freshly created account can never have children, so it is always a leaf.
    return toAccountNodeOutput({
      account,
      hasChildren: false,
      acceptsMovements: true,
      children: [],
    });
  }

  private async buildAccount(code: AccountCode, input: CreateAccountInput): Promise<Account> {
    const parentCode = code.parentCode();
    if (parentCode === null) {
      return Account.createClass(code, input.name, input.nature);
    }
    const parent = await this.accounts.findByCode(parentCode);
    if (parent === null) {
      throw new ParentAccountNotFoundError(code.value, parentCode.value);
    }
    return Account.createChild(code, input.name, parent, input.nature);
  }
}
