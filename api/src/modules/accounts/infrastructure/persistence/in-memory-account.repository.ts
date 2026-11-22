import type { AccountCode } from '../../domain/account-code.vo.js';
import type { Account } from '../../domain/account.entity.js';
import type { AccountRepository } from '../../domain/account.repository.js';
import { toAccount, toAccountRecord, type AccountRecord } from './account.mapper.js';

/**
 * Process-local {@link AccountRepository}. State lives as long as the Nest application instance.
 *
 * Stores plain records (not entities) so callers can never mutate stored state by reference.
 */
export class InMemoryAccountRepository implements AccountRepository {
  private readonly records = new Map<string, AccountRecord>();

  /**
   * Creates the repository.
   *
   * @param seed - Records loaded at construction time.
   */
  constructor(seed: ReadonlyArray<AccountRecord> = []) {
    for (const record of seed) {
      this.records.set(record.codigo, { ...record });
    }
  }

  /** {@inheritDoc AccountRepository.findAll} */
  findAll(): Promise<ReadonlyArray<Account>> {
    return Promise.resolve([...this.records.values()].map(toAccount));
  }

  /** {@inheritDoc AccountRepository.findByCode} */
  findByCode(code: AccountCode): Promise<Account | null> {
    const record = this.records.get(code.value);
    return Promise.resolve(record === undefined ? null : toAccount(record));
  }

  /** {@inheritDoc AccountRepository.hasChildren} */
  hasChildren(code: AccountCode): Promise<boolean> {
    for (const record of this.records.values()) {
      if (toAccount(record).code.parentCode()?.equals(code) === true) {
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }

  /** {@inheritDoc AccountRepository.save} */
  save(account: Account): Promise<void> {
    this.records.set(account.code.value, toAccountRecord(account));
    return Promise.resolve();
  }

  /** {@inheritDoc AccountRepository.delete} */
  delete(code: AccountCode): Promise<void> {
    this.records.delete(code.value);
    return Promise.resolve();
  }
}
