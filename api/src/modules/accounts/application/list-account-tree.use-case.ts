import { buildAccountTree } from '../domain/account-tree.js';
import type { AccountRepository } from '../domain/account.repository.js';
import { toAccountNodeOutput } from './account-node.mapper.js';
import type { AccountNodeOutput } from './account.dto.js';

/** Returns the whole chart of accounts as a hierarchy. */
export class ListAccountTreeUseCase {
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
   * Loads every account and nests it under its derived parent.
   *
   * @returns Root nodes (classes) ordered by code, with nested children.
   */
  async execute(): Promise<ReadonlyArray<AccountNodeOutput>> {
    const accounts = await this.accounts.findAll();
    return buildAccountTree(accounts).map(toAccountNodeOutput);
  }
}
