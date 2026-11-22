/** Accounting natures, keyed by their API value. */
export const ACCOUNT_NATURES = {
  DEBIT: "debito",
  CREDIT: "credito",
} as const;

/** Debit or credit nature of an account (inherited from its class). */
export type AccountNature = (typeof ACCOUNT_NATURES)[keyof typeof ACCOUNT_NATURES];

/** Hierarchy levels, keyed by their API value. */
export const ACCOUNT_LEVELS = {
  CLASS: "clase",
  GROUP: "grupo",
  ACCOUNT: "cuenta",
  SUBACCOUNT: "subcuenta",
} as const;

/** One hierarchy level of the chart of accounts. */
export type AccountLevel = (typeof ACCOUNT_LEVELS)[keyof typeof ACCOUNT_LEVELS];

/** Spanish labels shown in the UI for each nature. */
export const NATURE_LABELS: Readonly<Record<AccountNature, string>> = {
  debito: "Débito",
  credito: "Crédito",
};

/** Spanish labels shown in the UI for each level. */
export const LEVEL_LABELS: Readonly<Record<AccountLevel, string>> = {
  clase: "Clase",
  grupo: "Grupo",
  cuenta: "Cuenta",
  subcuenta: "Subcuenta",
};

/** Account with its subtree, as used by the UI. */
export interface AccountNode {
  readonly code: string;
  readonly name: string;
  readonly level: AccountLevel;
  readonly nature: AccountNature;
  readonly parentCode: string | null;
  readonly hasChildren: boolean;
  /** Only leaves accept accounting movements. */
  readonly acceptsMovements: boolean;
  readonly children: ReadonlyArray<AccountNode>;
}

/** Data needed to create an account. */
export interface CreateAccountPayload {
  readonly code: string;
  readonly name: string;
  /** Only sent for classes; descendants inherit it. */
  readonly nature?: AccountNature;
}

/** Form field names, matching the API's `campo` values so errors map directly. */
export const ACCOUNT_FORM_FIELDS = ["codigo", "nombre", "naturaleza"] as const;

/** One field of the account creation form. */
export type AccountFormField = (typeof ACCOUNT_FORM_FIELDS)[number];
