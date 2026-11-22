import { useCallback, useState } from "react";
import type { AccountsApi } from "../../api/accounts-api";
import type { ApiError, FieldErrors } from "../../api/api-error";
import type { AccountNode, CreateAccountPayload } from "../../types/account";
import { toApiError } from "./useAccountTree";

/** State and actions of the account creation flow. */
export interface CreateAccountState {
  readonly submitting: boolean;
  /** Last failure, or `null`. */
  readonly error: ApiError | null;
  /** Remaining per-field messages (cleared field by field as the user edits). */
  readonly fieldErrors: FieldErrors;
  /** Submits the payload; resolves to `true` on success. */
  readonly submit: (payload: CreateAccountPayload) => Promise<boolean>;
  /** Clears the error shown next to one field. */
  readonly clearFieldError: (field: string) => void;
}

/**
 * Orchestrates account creation: submitting state, server errors and the success callback.
 *
 * @param api - Accounts API client.
 * @param onCreated - Called with the created account after a successful request.
 * @returns Creation state and actions.
 */
export function useCreateAccount(
  api: AccountsApi,
  onCreated: (account: AccountNode) => void | Promise<void>,
): CreateAccountState {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const submit = useCallback(
    async (payload: CreateAccountPayload): Promise<boolean> => {
      setSubmitting(true);
      setError(null);
      setFieldErrors({});
      try {
        const created = await api.create(payload);
        await onCreated(created);
        return true;
      } catch (caught) {
        const apiError = toApiError(caught);
        setError(apiError);
        setFieldErrors(apiError.fieldErrors);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [api, onCreated],
  );

  const clearFieldError = useCallback((field: string): void => {
    setFieldErrors((current) => {
      if (!(field in current)) return current;
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  }, []);

  return { submitting, error, fieldErrors, submit, clearFieldError };
}
