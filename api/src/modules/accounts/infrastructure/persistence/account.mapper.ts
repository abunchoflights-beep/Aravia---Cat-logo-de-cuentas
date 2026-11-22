import type { AccountNature } from '../../domain/account-nature.js';
import { Account } from '../../domain/account.entity.js';

/** Storage shape of an account, decoupled from the domain entity. */
export interface AccountRecord {
  readonly codigo: string;
  readonly nombre: string;
  readonly naturaleza: AccountNature;
}

/**
 * Maps a domain account to its storage record.
 *
 * @param account - Domain account.
 * @returns The storage record.
 */
export function toAccountRecord(account: Account): AccountRecord {
  const snapshot = account.toSnapshot();
  return { codigo: snapshot.code, nombre: snapshot.name, naturaleza: snapshot.nature };
}

/**
 * Rebuilds a domain account from its storage record.
 *
 * @param record - Storage record.
 * @returns The domain account.
 * @throws {InvalidAccountCodeError} When the stored code is corrupt.
 */
export function toAccount(record: AccountRecord): Account {
  return Account.restore({ code: record.codigo, name: record.nombre, nature: record.naturaleza });
}
