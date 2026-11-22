import type { Account } from './account.entity.js';

/** Read-only tree projection of an account with its descendants. */
export interface AccountTreeNode {
  readonly account: Account;
  /** Whether the account has at least one child. */
  readonly hasChildren: boolean;
  /** Only leaf accounts accept accounting movements (rule R6). */
  readonly acceptsMovements: boolean;
  /** Direct children, ordered by code ascending. */
  readonly children: ReadonlyArray<AccountTreeNode>;
}

/**
 * Builds the catalog hierarchy from a flat list of accounts.
 *
 * Accounts whose parent is absent are treated as roots, so a partially loaded list still renders;
 * the creation rules (R4) guarantee this never happens with consistent data.
 *
 * @param accounts - Flat list of accounts in any order.
 * @returns Root nodes ordered by code, each with nested children ordered by code.
 */
export function buildAccountTree(accounts: ReadonlyArray<Account>): ReadonlyArray<AccountTreeNode> {
  const sorted = [...accounts].sort((a, b) => compareCodes(a.code.value, b.code.value));
  const known = new Set(sorted.map((account) => account.code.value));
  const childrenByCode = new Map<string, Account[]>();
  const roots: Account[] = [];

  for (const account of sorted) {
    const parent = account.code.parentCode();
    if (parent === null || !known.has(parent.value)) {
      roots.push(account);
      continue;
    }
    const siblings = childrenByCode.get(parent.value) ?? [];
    siblings.push(account);
    childrenByCode.set(parent.value, siblings);
  }

  const toNode = (account: Account): AccountTreeNode => {
    const children = (childrenByCode.get(account.code.value) ?? []).map(toNode);
    const hasChildren = children.length > 0;
    return { account, hasChildren, acceptsMovements: !hasChildren, children };
  };

  return roots.map(toNode);
}

function compareCodes(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
