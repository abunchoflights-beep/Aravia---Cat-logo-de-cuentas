import { useCallback, useState } from "react";
import type { AccountsApi } from "../../api/accounts-api";
import type { ApiError } from "../../api/api-error";
import { toApiError } from "./useAccountTree";

/** State and actions of the two-step (request → confirm) deletion flow. */
export interface DeleteAccountState {
  /** Code awaiting confirmation, or `null`. */
  readonly confirmingCode: string | null;
  /** Code whose deletion request is in flight, or `null`. */
  readonly pendingCode: string | null;
  readonly error: ApiError | null;
  /** Asks for confirmation before deleting `code`. */
  readonly request: (code: string) => void;
  /** Cancels the pending confirmation. */
  readonly cancel: () => void;
  /** Deletes the account awaiting confirmation; resolves to `true` on success. */
  readonly confirm: () => Promise<boolean>;
  /** Hides the last error. */
  readonly dismissError: () => void;
}

/**
 * Orchestrates account deletion with inline confirmation.
 *
 * @param api - Accounts API client.
 * @param onDeleted - Called with the deleted code after a successful request.
 * @returns Deletion state and actions.
 */
export function useDeleteAccount(
  api: AccountsApi,
  onDeleted: (code: string) => void | Promise<void>,
): DeleteAccountState {
  const [confirmingCode, setConfirmingCode] = useState<string | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const request = useCallback((code: string): void => {
    setConfirmingCode(code);
    setError(null);
  }, []);

  const cancel = useCallback((): void => {
    setConfirmingCode(null);
  }, []);

  const confirm = useCallback(async (): Promise<boolean> => {
    if (confirmingCode === null) return false;
    const code = confirmingCode;
    setPendingCode(code);
    setError(null);
    try {
      await api.remove(code);
      setConfirmingCode(null);
      await onDeleted(code);
      return true;
    } catch (caught) {
      setError(toApiError(caught));
      setConfirmingCode(null);
      return false;
    } finally {
      setPendingCode(null);
    }
  }, [api, confirmingCode, onDeleted]);

  const dismissError = useCallback((): void => {
    setError(null);
  }, []);

  return { confirmingCode, pendingCode, error, request, cancel, confirm, dismissError };
}
