import { useState, type FormEvent, type ReactNode } from "react";
import type { ApiError, FieldErrors } from "../../api/api-error";
import { Alert } from "../../components/Alert";
import { FieldError } from "../../components/FieldError";
import {
  ACCOUNT_FORM_FIELDS,
  NATURE_LABELS,
  type AccountFormField,
  type AccountNature,
  type AccountNode,
  type CreateAccountPayload,
} from "../../types/account";
import { findNode, parentCodeOf } from "./account-tree.utils";

/** Props of {@link CreateAccountForm}. */
export interface CreateAccountFormProps {
  /** Loaded tree, used to show the nature a new account will inherit. */
  readonly nodes: ReadonlyArray<AccountNode>;
  readonly submitting: boolean;
  readonly error: ApiError | null;
  /** Current per-field messages. */
  readonly fieldErrors: FieldErrors;
  /** Submits the payload; resolves to `true` on success (the form then resets). */
  readonly onSubmit: (payload: CreateAccountPayload) => Promise<boolean>;
  /** Called when the user edits a field, so its error can be cleared. */
  readonly onFieldEdit: (field: AccountFormField) => void;
}

const EMPTY_FORM = { codigo: "", nombre: "", naturaleza: "" } as const;

type FormValues = Record<AccountFormField, string>;

/**
 * Renders the account creation form with server errors next to each field.
 *
 * @param props - Tree, submission state, errors and callbacks.
 * @returns The form.
 */
export function CreateAccountForm({
  nodes,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onFieldEdit,
}: CreateAccountFormProps): ReactNode {
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);

  const code = values.codigo.trim();
  const isClass = code.length === 1;
  const parentCode = parentCodeOf(code);
  const parent = parentCode === null ? undefined : findNode(nodes, parentCode);
  const formError = error !== null && !isTiedToFormField(error) ? error : null;

  const update = (field: AccountFormField, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
    onFieldEdit(field);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const nature =
      isClass && values.naturaleza !== "" ? (values.naturaleza as AccountNature) : undefined;
    const created = await onSubmit({ code, name: values.nombre, nature });
    if (created) setValues(EMPTY_FORM);
  };

  return (
    <form className="form" noValidate onSubmit={(event) => void handleSubmit(event)}>
      <h2>Nueva cuenta</h2>
      <p className="form__hint">
        El código define el nivel: 1 dígito clase, 2 grupo, 4 cuenta y 6 subcuenta.
      </p>

      {formError !== null && <Alert tone="error">{formError.message}</Alert>}

      <fieldset disabled={submitting}>
        <Field label="Código" field="codigo" error={fieldErrors.codigo}>
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Ej. 110515"
              value={values.codigo}
              onChange={(event) => update("codigo", event.target.value)}
            />
          )}
        </Field>

        <Field label="Nombre" field="nombre" error={fieldErrors.nombre}>
          {(props) => (
            <input
              {...props}
              type="text"
              autoComplete="off"
              placeholder="Ej. Caja auxiliar"
              value={values.nombre}
              onChange={(event) => update("nombre", event.target.value)}
            />
          )}
        </Field>

        {isClass ? (
          <Field label="Naturaleza" field="naturaleza" error={fieldErrors.naturaleza}>
            {(props) => (
              <select
                {...props}
                value={values.naturaleza}
                onChange={(event) => update("naturaleza", event.target.value)}
              >
                <option value="">Selecciona…</option>
                <option value="debito">{NATURE_LABELS.debito}</option>
                <option value="credito">{NATURE_LABELS.credito}</option>
              </select>
            )}
          </Field>
        ) : (
          <>
            {parent !== undefined && (
              <p className="form__inherited">
                Heredará la naturaleza <strong>{NATURE_LABELS[parent.nature]}</strong> de{" "}
                {parent.code} {parent.name}.
              </p>
            )}
            <FieldError id="campo-naturaleza-error" message={fieldErrors.naturaleza} />
          </>
        )}

        <button type="submit" className="button button--primary">
          {submitting ? "Creando…" : "Crear cuenta"}
        </button>
      </fieldset>
    </form>
  );
}

function isTiedToFormField(error: ApiError): boolean {
  return ACCOUNT_FORM_FIELDS.some((field) => field in error.fieldErrors);
}

interface ControlProps {
  readonly id: string;
  readonly name: AccountFormField;
  readonly "aria-invalid": boolean;
  readonly "aria-describedby": string | undefined;
}

interface FieldProps {
  readonly label: string;
  readonly field: AccountFormField;
  readonly error: string | undefined;
  readonly children: (props: ControlProps) => ReactNode;
}

function Field({ label, field, error, children }: FieldProps): ReactNode {
  const id = `campo-${field}`;
  const errorId = `${id}-error`;
  return (
    <div className={`field${error === undefined ? "" : " field--invalid"}`}>
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        name: field,
        "aria-invalid": error !== undefined,
        "aria-describedby": error === undefined ? undefined : errorId,
      })}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
