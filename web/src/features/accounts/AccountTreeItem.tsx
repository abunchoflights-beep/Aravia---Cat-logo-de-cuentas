import type { ReactNode } from "react";
import { LEVEL_LABELS, NATURE_LABELS, type AccountNode } from "../../types/account";

/** Deletion state and callbacks shared by every row. */
export interface TreeDeletionControls {
  readonly confirmingCode: string | null;
  readonly pendingCode: string | null;
  readonly onRequest: (code: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/** Props of {@link AccountTreeItem}. */
export interface AccountTreeItemProps {
  readonly node: AccountNode;
  readonly depth: number;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (code: string) => void;
  readonly deletion: TreeDeletionControls;
}

/**
 * Renders one account row and, when expanded, its children (disclosure pattern).
 *
 * @param props - Node, depth, expansion state and deletion controls.
 * @returns The list item.
 */
export function AccountTreeItem({
  node,
  depth,
  expanded,
  onToggle,
  deletion,
}: AccountTreeItemProps): ReactNode {
  const isOpen = node.hasChildren && expanded.has(node.code);
  const groupId = `cuenta-${node.code}-hijas`;
  const label = `${node.code} ${node.name}`;

  return (
    <li className="tree-item">
      <div className="tree-row" style={{ paddingInlineStart: `${depth * 1.25 + 0.5}rem` }}>
        {node.hasChildren ? (
          <button
            type="button"
            className="tree-toggle"
            aria-expanded={isOpen}
            aria-controls={groupId}
            aria-label={`${isOpen ? "Colapsar" : "Expandir"} ${label}`}
            onClick={() => onToggle(node.code)}
          >
            <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
          </button>
        ) : (
          <span className="tree-toggle tree-toggle--leaf" aria-hidden="true" />
        )}
        <span className="tree-code">{node.code}</span>
        <span className="tree-name">{node.name}</span>
        <span className={`badge badge--${node.level}`}>{LEVEL_LABELS[node.level]}</span>
        <span className={`nature nature--${node.nature}`}>{NATURE_LABELS[node.nature]}</span>
        {node.acceptsMovements && <span className="badge badge--leaf">Admite movimientos</span>}
        {node.acceptsMovements && <DeleteControls node={node} deletion={deletion} />}
      </div>
      {isOpen && (
        <ul id={groupId} className="tree-group" aria-label={`Cuentas hijas de ${label}`}>
          {node.children.map((child) => (
            <AccountTreeItem
              key={child.code}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              deletion={deletion}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface DeleteControlsProps {
  readonly node: AccountNode;
  readonly deletion: TreeDeletionControls;
}

function DeleteControls({ node, deletion }: DeleteControlsProps): ReactNode {
  const isPending = deletion.pendingCode === node.code;
  const busy = deletion.pendingCode !== null;

  if (deletion.confirmingCode === node.code || isPending) {
    return (
      <span
        className="tree-actions"
        role="group"
        aria-label={`Confirmar eliminación de ${node.code}`}
      >
        <span className="tree-confirm">¿Eliminar {node.code}?</span>
        <button
          type="button"
          className="button button--danger button--small"
          disabled={busy}
          onClick={deletion.onConfirm}
        >
          {isPending ? "Eliminando…" : "Confirmar"}
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={busy}
          onClick={deletion.onCancel}
        >
          Cancelar
        </button>
      </span>
    );
  }

  return (
    <span className="tree-actions">
      <button
        type="button"
        className="button button--ghost button--small"
        aria-label={`Eliminar ${node.code} ${node.name}`}
        disabled={busy}
        onClick={() => deletion.onRequest(node.code)}
      >
        Eliminar
      </button>
    </span>
  );
}
