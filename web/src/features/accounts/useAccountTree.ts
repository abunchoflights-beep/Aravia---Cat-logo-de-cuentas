import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountsApi } from "../../api/accounts-api";
import { ApiError } from "../../api/api-error";
import type { AccountNode } from "../../types/account";
import { ancestorCodes, branchCodes } from "./account-tree.utils";

/** State and actions of the catalog tree. */
export interface AccountTreeState {
  /** Last loaded tree; `null` until the first successful load. */
  readonly nodes: ReadonlyArray<AccountNode> | null;
  readonly loading: boolean;
  readonly error: ApiError | null;
  /** Codes of the expanded branches. */
  readonly expanded: ReadonlySet<string>;
  /** Reloads the tree from the API. */
  readonly reload: () => Promise<void>;
  /** Expands or collapses one branch. */
  readonly toggle: (code: string) => void;
  /** Expands every branch of the loaded tree. */
  readonly expandAll: () => void;
  /** Collapses every branch. */
  readonly collapseAll: () => void;
  /** Expands the ancestors of `code` so it becomes visible. */
  readonly reveal: (code: string) => void;
}

/**
 * Loads the catalog tree and tracks which branches are expanded.
 *
 * The previous tree stays visible while reloading, so mutations do not flash a loading screen.
 *
 * @param api - Accounts API client.
 * @returns Tree state and actions.
 */
export function useAccountTree(api: AccountsApi): AccountTreeState {
  const [nodes, setNodes] = useState<ReadonlyArray<AccountNode> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // Only the latest request may update state; older responses are discarded.
  const latestRequest = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError(null);
    try {
      const tree = await api.listTree();
      if (requestId === latestRequest.current) setNodes(tree);
    } catch (caught) {
      if (requestId === latestRequest.current) setError(toApiError(caught));
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void reload();
    return () => {
      // Invalidates in-flight responses after unmount (and StrictMode's double effect).
      latestRequest.current++;
    };
  }, [reload]);

  const toggle = useCallback((code: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const expandAll = useCallback((): void => {
    setExpanded(new Set(branchCodes(nodes ?? [])));
  }, [nodes]);

  const collapseAll = useCallback((): void => {
    setExpanded(new Set());
  }, []);

  const reveal = useCallback((code: string): void => {
    setExpanded((current) => new Set([...current, ...ancestorCodes(code)]));
  }, []);

  return { nodes, loading, error, expanded, reload, toggle, expandAll, collapseAll, reveal };
}

/**
 * Normalizes anything thrown by an API call into an {@link ApiError}.
 *
 * @param caught - Thrown value.
 * @returns The same error when it is an `ApiError`, otherwise a generic one.
 */
export function toApiError(caught: unknown): ApiError {
  if (caught instanceof ApiError) return caught;
  return new ApiError({
    status: null,
    code: "ERROR_INESPERADO",
    message: "Ocurrió un error inesperado. Inténtalo de nuevo.",
  });
}
