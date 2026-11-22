import type { ReactNode } from "react";

/** Visual tone of an {@link Alert}. */
export type AlertTone = "error" | "success" | "info";

/** Props of {@link Alert}. */
export interface AlertProps {
  readonly tone: AlertTone;
  readonly children: ReactNode;
  /** Optional action rendered at the end (e.g. a retry button). */
  readonly action?: ReactNode;
}

/**
 * Renders a message box. Errors use `role="alert"` (interrupting); the rest use `role="status"`.
 *
 * @param props - Tone, content and optional action.
 * @returns The alert element.
 */
export function Alert({ tone, children, action }: AlertProps): ReactNode {
  return (
    <div className={`alert alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <div className="alert__content">{children}</div>
      {action !== undefined && <div className="alert__action">{action}</div>}
    </div>
  );
}
