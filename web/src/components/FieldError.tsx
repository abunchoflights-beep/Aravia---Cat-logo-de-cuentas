import type { ReactNode } from "react";

/** Props of {@link FieldError}. */
export interface FieldErrorProps {
  /** Element id, referenced by the input's `aria-describedby`. */
  readonly id: string;
  readonly message: string | undefined;
}

/**
 * Renders the error message shown right below a form field, or nothing when there is none.
 *
 * @param props - Element id and message.
 * @returns The message element, or `null`.
 */
export function FieldError({ id, message }: FieldErrorProps): ReactNode {
  if (message === undefined) return null;
  return (
    <p id={id} className="field-error">
      {message}
    </p>
  );
}
