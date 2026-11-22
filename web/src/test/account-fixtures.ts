import type { AccountLevel, AccountNature, AccountNode } from "../types/account";

const LEVEL_BY_LENGTH: Readonly<Record<number, AccountLevel>> = {
  1: "clase",
  2: "grupo",
  4: "cuenta",
  6: "subcuenta",
};
const PARENT_LENGTH: Readonly<Record<number, number>> = { 2: 1, 4: 2, 6: 4 };

/**
 * Builds a UI account node for tests, deriving level, parent and leaf flags from the code.
 *
 * @param code - Account code.
 * @param name - Account name.
 * @param nature - Nature.
 * @param children - Child nodes.
 * @returns The node.
 */
export function node(
  code: string,
  name: string,
  nature: AccountNature,
  children: ReadonlyArray<AccountNode> = [],
): AccountNode {
  const parentLength = PARENT_LENGTH[code.length];
  return {
    code,
    name,
    level: LEVEL_BY_LENGTH[code.length],
    nature,
    parentCode: parentLength === undefined ? null : code.slice(0, parentLength),
    hasChildren: children.length > 0,
    acceptsMovements: children.length === 0,
    children,
  };
}

/**
 * Returns the sample catalog from the specification.
 *
 * @param cashChildren - Children of `1105 Caja`; defaults to the two sample subaccounts.
 * @returns Root nodes of the sample catalog.
 */
export function sampleTree(
  cashChildren: ReadonlyArray<AccountNode> = [
    node("110505", "Caja general", "debito"),
    node("110510", "Caja menor", "debito"),
  ],
): AccountNode[] {
  return [
    node("1", "Activo", "debito", [
      node("11", "Disponible", "debito", [node("1105", "Caja", "debito", cashChildren)]),
    ]),
    node("2", "Pasivo", "credito", [
      node("21", "Obligaciones financieras", "credito", [
        node("2105", "Bancos nacionales", "credito"),
      ]),
    ]),
  ];
}

/** A promise whose settlement is controlled by the test. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

/**
 * Creates a {@link Deferred}, used to observe loading states before a request settles.
 *
 * @returns The deferred.
 */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
