import { useCallback, useState, type ReactNode } from "react";
import type { AccountsApi } from "../../api/accounts-api";
import { Alert } from "../../components/Alert";
import type { AccountNode, CreateAccountPayload } from "../../types/account";
import { AccountTree } from "./AccountTree";
import { CreateAccountForm } from "./CreateAccountForm";
import { useAccountTree } from "./useAccountTree";
import { useCreateAccount } from "./useCreateAccount";
import { useDeleteAccount } from "./useDeleteAccount";

/** Props of {@link AccountsPage}. */
export interface AccountsPageProps {
  /** API client; injected so the page can be tested without network. */
  readonly api: AccountsApi;
}

/**
 * Chart-of-accounts screen: collapsible tree, creation form and inline deletion.
 *
 * @param props - The accounts API client.
 * @returns The page.
 */
export function AccountsPage({ api }: AccountsPageProps): ReactNode {
  const tree = useAccountTree(api);
  const [notice, setNotice] = useState<string | null>(null);
  const { reload, reveal } = tree;

  const handleCreated = useCallback(
    async (account: AccountNode): Promise<void> => {
      setNotice(`Cuenta ${account.code} creada.`);
      await reload();
      reveal(account.code);
    },
    [reload, reveal],
  );

  const handleDeleted = useCallback(
    async (code: string): Promise<void> => {
      setNotice(`Cuenta ${code} eliminada.`);
      await reload();
    },
    [reload],
  );

  const creation = useCreateAccount(api, handleCreated);
  const deletion = useDeleteAccount(api, handleDeleted);

  const { submit: submitCreation } = creation;
  const { request: requestDeletion } = deletion;

  const submit = useCallback(
    (payload: CreateAccountPayload): Promise<boolean> => {
      setNotice(null);
      return submitCreation(payload);
    },
    [submitCreation],
  );

  const requestDelete = useCallback(
    (code: string): void => {
      setNotice(null);
      requestDeletion(code);
    },
    [requestDeletion],
  );

  const retry = (
    <button type="button" className="button button--small" onClick={() => void reload()}>
      Reintentar
    </button>
  );

  return (
    <main className="page">
      <header className="page__header">
        <h1>Catálogo de cuentas</h1>
        <p>Consulta la jerarquía, crea cuentas nuevas y elimina las que no tienen hijas.</p>
      </header>

      {notice !== null && <Alert tone="success">{notice}</Alert>}

      <div className="layout">
        <section className="panel" aria-labelledby="titulo-arbol">
          <div className="panel__header">
            <h2 id="titulo-arbol">Cuentas</h2>
            <div className="toolbar">
              <button
                type="button"
                className="button button--small"
                disabled={tree.nodes === null || tree.nodes.length === 0}
                onClick={tree.expandAll}
              >
                Expandir todo
              </button>
              <button
                type="button"
                className="button button--small"
                disabled={tree.nodes === null || tree.nodes.length === 0}
                onClick={tree.collapseAll}
              >
                Colapsar todo
              </button>
            </div>
          </div>

          {deletion.error !== null && (
            <Alert
              tone="error"
              action={
                <button
                  type="button"
                  className="button button--small"
                  onClick={deletion.dismissError}
                >
                  Cerrar
                </button>
              }
            >
              {deletion.error.message}
            </Alert>
          )}

          {tree.error !== null && (
            <Alert tone="error" action={retry}>
              {tree.error.message}
            </Alert>
          )}

          {tree.nodes === null && tree.loading && (
            <p className="loading" role="status">
              Cargando catálogo…
            </p>
          )}

          {tree.nodes !== null && (
            <>
              {tree.loading && (
                <p className="loading loading--inline" role="status">
                  Actualizando…
                </p>
              )}
              <AccountTree
                nodes={tree.nodes}
                expanded={tree.expanded}
                onToggle={tree.toggle}
                deletion={{
                  confirmingCode: deletion.confirmingCode,
                  pendingCode: deletion.pendingCode,
                  onRequest: requestDelete,
                  onCancel: deletion.cancel,
                  onConfirm: () => void deletion.confirm(),
                }}
              />
            </>
          )}
        </section>

        <section className="panel" aria-label="Crear cuenta">
          <CreateAccountForm
            nodes={tree.nodes ?? []}
            submitting={creation.submitting}
            error={creation.error}
            fieldErrors={creation.fieldErrors}
            onSubmit={submit}
            onFieldEdit={creation.clearFieldError}
          />
        </section>
      </div>
    </main>
  );
}
