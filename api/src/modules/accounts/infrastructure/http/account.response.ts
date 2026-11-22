import type { AccountNodeOutput } from '../../application/account.dto.js';
import type { AccountLevel } from '../../domain/account-level.js';
import type { AccountNature } from '../../domain/account-nature.js';

/** Public JSON shape of an account node (spec §4.1). */
export interface AccountNodeResponse {
  readonly codigo: string;
  readonly nombre: string;
  readonly nivel: AccountLevel;
  readonly naturaleza: AccountNature;
  readonly codigoPadre: string | null;
  readonly tieneHijas: boolean;
  readonly admiteMovimientos: boolean;
  readonly hijas: ReadonlyArray<AccountNodeResponse>;
}

/**
 * Serializes a use-case output node (and its subtree) to the public Spanish contract.
 *
 * @param node - Application output node.
 * @returns The response node.
 */
export function toAccountNodeResponse(node: AccountNodeOutput): AccountNodeResponse {
  return {
    codigo: node.code,
    nombre: node.name,
    nivel: node.level,
    naturaleza: node.nature,
    codigoPadre: node.parentCode,
    tieneHijas: node.hasChildren,
    admiteMovimientos: node.acceptsMovements,
    hijas: node.children.map(toAccountNodeResponse),
  };
}
