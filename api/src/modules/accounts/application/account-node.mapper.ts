import type { AccountTreeNode } from '../domain/account-tree.js';
import type { AccountNodeOutput } from './account.dto.js';

/**
 * Maps a domain tree node (and its subtree) to the application output contract.
 *
 * @param node - Domain tree node.
 * @returns The equivalent output node.
 */
export function toAccountNodeOutput(node: AccountTreeNode): AccountNodeOutput {
  const { account } = node;
  return {
    code: account.code.value,
    name: account.name,
    level: account.level,
    nature: account.nature,
    parentCode: account.code.parentCode()?.value ?? null,
    hasChildren: node.hasChildren,
    acceptsMovements: node.acceptsMovements,
    children: node.children.map(toAccountNodeOutput),
  };
}
