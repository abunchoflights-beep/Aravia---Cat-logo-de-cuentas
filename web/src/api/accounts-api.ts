import type {
  AccountLevel,
  AccountNature,
  AccountNode,
  CreateAccountPayload,
} from "../types/account";
import { ApiError, INVALID_RESPONSE_CODE } from "./api-error";
import type { HttpClient } from "./http-client";

/** Operations on the chart of accounts. Injected into hooks so tests never hit the network. */
export interface AccountsApi {
  /**
   * Loads the whole catalog as a tree.
   *
   * @returns Root accounts (classes) with nested children.
   * @throws {ApiError} When the request fails.
   */
  listTree(): Promise<ReadonlyArray<AccountNode>>;

  /**
   * Creates an account.
   *
   * @param payload - Code, name and (for classes) nature.
   * @returns The created account.
   * @throws {ApiError} With per-field errors when the server rejects the data.
   */
  create(payload: CreateAccountPayload): Promise<AccountNode>;

  /**
   * Deletes a leaf account.
   *
   * @param code - Code of the account to delete.
   * @throws {ApiError} When the account does not exist or has children.
   */
  remove(code: string): Promise<void>;
}

/**
 * Creates the HTTP implementation of {@link AccountsApi}.
 *
 * @param http - JSON transport.
 * @returns The API client.
 */
export function createAccountsApi(http: HttpClient): AccountsApi {
  return {
    async listTree(): Promise<ReadonlyArray<AccountNode>> {
      const body = await http.request("/cuentas");
      if (!Array.isArray(body)) {
        throw contractError();
      }
      return body.map(parseNode);
    },

    async create(payload: CreateAccountPayload): Promise<AccountNode> {
      const body = await http.request("/cuentas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo: payload.code,
          nombre: payload.name,
          ...(payload.nature === undefined ? {} : { naturaleza: payload.nature }),
        }),
      });
      return parseNode(body);
    },

    async remove(code: string): Promise<void> {
      await http.request(`/cuentas/${encodeURIComponent(code)}`, { method: "DELETE" });
    },
  };
}

const LEVELS: ReadonlyArray<string> = ["clase", "grupo", "cuenta", "subcuenta"];
const NATURES: ReadonlyArray<string> = ["debito", "credito"];

/**
 * Validates one wire node (Spanish JSON) and maps it to the UI model.
 *
 * @param value - Untrusted JSON value.
 * @returns The UI node.
 * @throws {ApiError} When the value does not follow the contract.
 */
export function parseNode(value: unknown): AccountNode {
  if (
    typeof value !== "object" ||
    value === null ||
    !("codigo" in value) ||
    !("nombre" in value) ||
    !("nivel" in value) ||
    !("naturaleza" in value) ||
    !("codigoPadre" in value) ||
    !("tieneHijas" in value) ||
    !("admiteMovimientos" in value) ||
    !("hijas" in value)
  ) {
    throw contractError();
  }
  const { codigo, nombre, nivel, naturaleza, codigoPadre, tieneHijas, admiteMovimientos, hijas } =
    value;
  if (
    typeof codigo !== "string" ||
    typeof nombre !== "string" ||
    typeof nivel !== "string" ||
    !LEVELS.includes(nivel) ||
    typeof naturaleza !== "string" ||
    !NATURES.includes(naturaleza) ||
    (codigoPadre !== null && typeof codigoPadre !== "string") ||
    typeof tieneHijas !== "boolean" ||
    typeof admiteMovimientos !== "boolean" ||
    !Array.isArray(hijas)
  ) {
    throw contractError();
  }
  return {
    code: codigo,
    name: nombre,
    level: nivel as AccountLevel,
    nature: naturaleza as AccountNature,
    parentCode: codigoPadre,
    hasChildren: tieneHijas,
    acceptsMovements: admiteMovimientos,
    children: hijas.map(parseNode),
  };
}

function contractError(): ApiError {
  return new ApiError({
    status: null,
    code: INVALID_RESPONSE_CODE,
    message: "El servidor envió una respuesta inesperada. Inténtalo de nuevo más tarde.",
  });
}
