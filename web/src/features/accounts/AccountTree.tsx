import type { ReactNode } from "react";
import type { AccountNode } from "../../types/account";
import { AccountTreeItem, type TreeDeletionControls } from "./AccountTreeItem";

/** Props of {@link AccountTree}. */
export interface AccountTreeProps {
  readonly nodes: ReadonlyArray<AccountNode>;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (code: string) => void;
  readonly deletion: TreeDeletionControls;
}

/**
 * Renders the catalog as nested, collapsible lists.
 *
 * @param props - Root nodes, expansion state and deletion controls.
 * @returns The tree, or an empty-state message.
 */
export function AccountTree({ nodes, expanded, onToggle, deletion }: AccountTreeProps): ReactNode {
  if (nodes.length === 0) {
    return <p className="empty">El catálogo está vacío. Crea una clase para empezar.</p>;
  }
  return (
    <ul className="tree" aria-label="Catálogo de cuentas">
      {nodes.map((node) => (
        <AccountTreeItem
          key={node.code}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={onToggle}
          deletion={deletion}
        />
      ))}
    </ul>
  );
}
