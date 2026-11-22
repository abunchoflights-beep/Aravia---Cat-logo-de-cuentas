import type { AccountLevel } from '../domain/account-level.js';
import type { AccountNature } from '../domain/account-nature.js';

/** Input of {@link CreateAccountUseCase}. The parent is never sent: it is derived from the code. */
export interface CreateAccountInput {
  readonly code: string;
  readonly name: string;
  /** Mandatory for classes; optional for descendants (inherited, must match when sent). */
  readonly nature?: AccountNature;
}

/** Account projection returned by use cases, with its subtree. */
export interface AccountNodeOutput {
  readonly code: string;
  readonly name: string;
  readonly level: AccountLevel;
  readonly nature: AccountNature;
  readonly parentCode: string | null;
  readonly hasChildren: boolean;
  readonly acceptsMovements: boolean;
  readonly children: ReadonlyArray<AccountNodeOutput>;
}
