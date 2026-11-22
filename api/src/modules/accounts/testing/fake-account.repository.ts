import type { AccountCode } from '../domain/account-code.vo.js';
import { Account, type AccountSnapshot } from '../domain/account.entity.js';
import type { AccountRepository } from '../domain/account.repository.js';

/** Sample catalog from the specification, as snapshots. */
export const SAMPLE_CATALOG: ReadonlyArray<AccountSnapshot> = [
  { code: '1', name: 'Activo', nature: 'debito' },
  { code: '11', name: 'Disponible', nature: 'debito' },
  { code: '1105', name: 'Caja', nature: 'debito' },
  { code: '110505', name: 'Caja general', nature: 'debito' },
  { code: '110510', name: 'Caja menor', nature: 'debito' },
  { code: '2', name: 'Pasivo', nature: 'credito' },
  { code: '21', name: 'Obligaciones financieras', nature: 'credito' },
  { code: '2105', name: 'Bancos nacionales', nature: 'credito' },
];

/** Minimal in-memory {@link AccountRepository} for use-case tests; records every write. */
export class FakeAccountRepository implements AccountRepository {
  readonly saved: Account[] = [];
  readonly deleted: string[] = [];
  private readonly store = new Map<string, Account>();

  /**
   * Creates the fake, optionally pre-loaded.
   *
   * @param snapshots - Initial accounts.
   */
  constructor(snapshots: ReadonlyArray<AccountSnapshot> = []) {
    for (const snapshot of snapshots) {
      this.store.set(snapshot.code, Account.restore(snapshot));
    }
  }

  /** @returns Codes currently stored, sorted. */
  codes(): string[] {
    return [...this.store.keys()].sort();
  }

  findAll(): Promise<ReadonlyArray<Account>> {
    return Promise.resolve([...this.store.values()]);
  }

  findByCode(code: AccountCode): Promise<Account | null> {
    return Promise.resolve(this.store.get(code.value) ?? null);
  }

  hasChildren(code: AccountCode): Promise<boolean> {
    return Promise.resolve([...this.store.values()].some((a) => code.isParentOf(a.code)));
  }

  save(account: Account): Promise<void> {
    this.saved.push(account);
    this.store.set(account.code.value, account);
    return Promise.resolve();
  }

  delete(code: AccountCode): Promise<void> {
    this.deleted.push(code.value);
    this.store.delete(code.value);
    return Promise.resolve();
  }
}
