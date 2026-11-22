import type { AccountNode } from "../../types/account";

/** Code length of each level, root to leaf (Clase, Grupo, Cuenta, Subcuenta). */
const LEVEL_LENGTHS: ReadonlyArray<number> = [1, 2, 4, 6];

/**
 * Finds a node anywhere in the tree.
 *
 * @param nodes - Root nodes.
 * @param code - Code to look for.
 * @returns The node, or `undefined` when absent.
 */
export function findNode(nodes: ReadonlyArray<AccountNode>, code: string): AccountNode | undefined {
  for (const node of nodes) {
    if (node.code === code) return node;
    const found = findNode(node.children, code);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Derives the codes of every ancestor of a code, from the class down to the parent.
 *
 * @param code - Account code.
 * @returns Ancestor codes (e.g. `110515` → `["1", "11", "1105"]`); empty for invalid codes.
 */
export function ancestorCodes(code: string): string[] {
  const levelIndex = LEVEL_LENGTHS.indexOf(code.length);
  if (!/^\d+$/.test(code) || levelIndex <= 0) {
    return [];
  }
  return LEVEL_LENGTHS.slice(0, levelIndex).map((length) => code.slice(0, length));
}

/**
 * Derives the parent code: the prefix of the previous level's length.
 *
 * @param code - Account code (possibly incomplete, as typed by the user).
 * @returns The parent code, or `null` for classes and invalid codes.
 */
export function parentCodeOf(code: string): string | null {
  return ancestorCodes(code).at(-1) ?? null;
}

/**
 * Collects the codes of every node that has children.
 *
 * @param nodes - Root nodes.
 * @returns Codes of all branches.
 */
export function branchCodes(nodes: ReadonlyArray<AccountNode>): string[] {
  return nodes.flatMap((node) =>
    node.hasChildren ? [node.code, ...branchCodes(node.children)] : [],
  );
}
