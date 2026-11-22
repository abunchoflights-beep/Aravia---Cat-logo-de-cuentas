/** Accounting nature of a class, keyed by its Spanish API value. */
export const ACCOUNT_NATURES = {
  DEBIT: 'debito',
  CREDIT: 'credito',
} as const;

/** Debit or credit nature, inherited by every descendant of a class. */
export type AccountNature = (typeof ACCOUNT_NATURES)[keyof typeof ACCOUNT_NATURES];

/**
 * Returns the Spanish, human-readable label of a nature (with accents) for messages.
 *
 * @param nature - Account nature.
 * @returns `débito` or `crédito`.
 */
export function natureLabel(nature: AccountNature): string {
  return nature === ACCOUNT_NATURES.DEBIT ? 'débito' : 'crédito';
}
