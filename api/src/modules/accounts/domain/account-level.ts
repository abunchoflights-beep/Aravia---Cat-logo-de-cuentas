/** Hierarchy levels of the chart of accounts, keyed by their Spanish API value. */
export const ACCOUNT_LEVELS = {
  CLASS: 'clase',
  GROUP: 'grupo',
  ACCOUNT: 'cuenta',
  SUBACCOUNT: 'subcuenta',
} as const;

/** One hierarchy level of the chart of accounts. */
export type AccountLevel = (typeof ACCOUNT_LEVELS)[keyof typeof ACCOUNT_LEVELS];

/** Pairs a level with the code length that identifies it. */
export interface LevelCodeLength {
  readonly level: AccountLevel;
  readonly length: number;
}

/**
 * Code length for each level, ordered from root to leaf.
 *
 * The position in this list is what defines "previous level" when deriving a parent code.
 */
export const LEVEL_CODE_LENGTHS: ReadonlyArray<LevelCodeLength> = [
  { level: ACCOUNT_LEVELS.CLASS, length: 1 },
  { level: ACCOUNT_LEVELS.GROUP, length: 2 },
  { level: ACCOUNT_LEVELS.ACCOUNT, length: 4 },
  { level: ACCOUNT_LEVELS.SUBACCOUNT, length: 6 },
];
