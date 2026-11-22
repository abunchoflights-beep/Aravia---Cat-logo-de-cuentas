# Spec 001 — Catálogo de cuentas como árbol (ver, crear, eliminar)

> **Estado:** Implementado · **Fecha:** 2026-11-21

## 1. Problem Statement & Scope

A contador needs to browse the chart of accounts (catálogo de cuentas) as a hierarchy, add new accounts
with immediate field-level feedback, and remove accounts that have no children — always seeing what the
system is doing (loading) and what went wrong (errors).

### User stories

| ID  | Historia                                                                                     |
| --- | -------------------------------------------------------------------------------------------- |
| H1  | Como contador quiero ver el catálogo como árbol, y expandir y colapsar ramas.                |
| H2  | Como contador puedo crear una cuenta nueva y ver los errores junto al campo correspondiente. |
| H3  | Como contador quiero poder eliminar cuentas si no tienen hijas.                              |
| H4  | Quiero ver estados de carga y de error en las operaciones (consultar, crear y eliminar).     |

### In scope

- Read the whole catalog as a tree (`GET /cuentas`).
- Create one account (`POST /cuentas`).
- Delete one leaf account (`DELETE /cuentas/:codigo`).
- In-memory persistence seeded with the sample catalog (Section 3.3).
- React UI: tree with expand/collapse, creation form with per-field errors, inline delete confirmation,
  loading/error states for the three operations.

### Out of scope (explicit)

- Editing an account (rename, change code) and soft-deactivation (`activa`).
- Accounting movements (journal entries) and balances. Rule 6 is only **exposed** as a derived flag
  (`admiteMovimientos`) so a future movements feature can rely on it.
- Durable persistence (database), authentication/authorization, pagination, search.
- Levels deeper than 6 digits (e.g. 8-digit auxiliary accounts).

## 2. Domain Invariants & Business Rules

| #   | Regla                                                                                                                              | Enforcement                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| R1  | Cada cuenta tiene un **código numérico** y un **nombre**.                                                                          | `AccountCode` VO (digits only), `Account` entity (non-empty name).   |
| R2  | La longitud del código define el nivel: 1 → Clase, 2 → Grupo, 4 → Cuenta, 6 → Subcuenta. Cualquier otra longitud es inválida.      | `AccountCode.level`                                                  |
| R3  | El padre es la cuenta cuyo código es su prefijo en el nivel anterior (`110505` → `1105` → `11` → `1`). Las clases no tienen padre. | `AccountCode.parentCode()` (derived, never sent by the client)       |
| R4  | No se puede crear una cuenta si su padre no existe.                                                                                | `CreateAccountUseCase` → `CUENTA_PADRE_NO_ENCONTRADA`                |
| R5  | No se puede eliminar una cuenta que tenga cuentas hijas.                                                                           | `DeleteAccountUseCase` → `CUENTA_CON_CUENTAS_HIJAS`                  |
| R6  | Solo las cuentas sin hijas admiten movimientos contables.                                                                          | Derived `admiteMovimientos = !tieneHijas` in the tree projection     |
| R7  | El código es único en todo el catálogo.                                                                                            | `CreateAccountUseCase` → `CODIGO_CUENTA_DUPLICADO`                   |
| R8  | Cada clase tiene una naturaleza (débito o crédito) y todos sus descendientes la heredan.                                           | `Account.createClass` requires it; `Account.createChild` inherits it |

Derived consequences:

- Because the parent is derived from the code (R3), self-parenting and circular ancestry are impossible
  by construction; `JERARQUIA_CUENTA_INVALIDA` is therefore not needed by this feature.
- A class **must** receive `naturaleza` on creation (`NATURALEZA_CUENTA_REQUERIDA`).
- A non-class account may omit `naturaleza` (it is inherited). If it is sent and differs from the
  parent's nature, creation fails with `NATURALEZA_CUENTA_INCOMPATIBLE`.
- The account name is trimmed; it must have 1–120 characters after trimming.
- Siblings are always ordered by code ascending.

## 3. Functional Requirements & Acceptance Criteria

### 3.1 H1 — Ver el catálogo como árbol

- **AC1.1** _Given_ the seeded catalog, _when_ `GET /cuentas` is called, _then_ it responds `200` with
  the two classes `1` and `2` as roots, each with its descendants nested in `hijas`, ordered by code.
- **AC1.2** _Given_ the tree, _then_ every node exposes `codigo`, `nombre`, `nivel`, `naturaleza`
  (inherited for non-classes), `codigoPadre` (`null` for classes), `tieneHijas` and `admiteMovimientos`
  (`true` only for leaves).
- **AC1.3** _Given_ the UI has loaded, _then_ only the classes are visible and branches are collapsed.
- **AC1.4** _When_ the user activates a branch toggle, _then_ its children appear (`aria-expanded="true"`);
  activating it again hides them. Leaves show no toggle.
- **AC1.5** _When_ the user presses «Expandir todo» / «Colapsar todo», _then_ every branch opens / closes.
- **AC1.6** _Given_ an empty catalog, _then_ the UI shows «El catálogo está vacío. Crea una clase para empezar.»

### 3.2 H2 — Crear una cuenta con errores junto al campo

- **AC2.1** _Given_ `1105` exists, _when_ `POST /cuentas {codigo:"110515", nombre:"Caja auxiliar"}`,
  _then_ `201` with the created node (`nivel:"subcuenta"`, `naturaleza:"debito"`, `codigoPadre:"1105"`,
  `tieneHijas:false`, `admiteMovimientos:true`) and `GET /cuentas` includes it under `1105`.
- **AC2.2** _When_ creating class `3` with `naturaleza:"credito"`, _then_ `201`, `codigoPadre:null`.
- **AC2.3** _When_ `codigo` is missing, non-numeric, or its length is not 1, 2, 4 or 6, _then_ `400`
  `VALIDACION_ENTRADA_FALLIDA` with a `details` entry for `campo:"codigo"`.
- **AC2.4** _When_ `nombre` is missing, blank, or longer than 120 characters, _then_ `400`
  `VALIDACION_ENTRADA_FALLIDA` with a `details` entry for `campo:"nombre"`.
- **AC2.5** _When_ `naturaleza` is not `debito`/`credito`, _then_ `400` with `campo:"naturaleza"`.
- **AC2.6** _When_ the body contains unknown properties (e.g. `codigoPadre`), _then_ `400` with a
  `details` entry for that property.
- **AC2.7** _When_ `codigo` already exists, _then_ `409` `CODIGO_CUENTA_DUPLICADO`, `details.campo:"codigo"`.
- **AC2.8** _When_ the parent does not exist (e.g. `9905`, whose parent `99` is missing), _then_ `404`
  `CUENTA_PADRE_NO_ENCONTRADA`,
  `details.campo:"codigo"`, and the message names the missing parent code.
- **AC2.9** _When_ creating a class without `naturaleza`, _then_ `422` `NATURALEZA_CUENTA_REQUERIDA`,
  `details.campo:"naturaleza"`.
- **AC2.10** _When_ creating a non-class with a `naturaleza` different from its parent's, _then_ `422`
  `NATURALEZA_CUENTA_INCOMPATIBLE`, `details.campo:"naturaleza"`.
- **AC2.11** UI: every error whose `campo` matches a form field (`codigo`, `nombre`, `naturaleza`) is
  rendered right below that field (`aria-invalid="true"`, `aria-describedby`); errors without a field are
  rendered as a form-level alert.
- **AC2.12** UI: the «Naturaleza» selector is shown only when the typed code has 1 digit; otherwise the
  form shows the nature it will inherit when the parent is present in the loaded tree.
- **AC2.13** UI: on success the form is cleared, the tree reloads, the new account's ancestors are
  expanded so it is visible, and a success message «Cuenta 110515 creada.» is shown.
- **AC2.14** UI: editing a field clears that field's error.

### 3.3 Seed data

```
1       Activo                      (débito)
11      Disponible
1105    Caja
110505  Caja general
110510  Caja menor
2       Pasivo                      (crédito)
21      Obligaciones financieras
2105    Bancos nacionales
```

### 3.4 H3 — Eliminar cuentas sin hijas

- **AC3.1** _Given_ `110510` has no children, _when_ `DELETE /cuentas/110510`, _then_ `204` and it no
  longer appears in `GET /cuentas`; `1105` keeps `110505` as its only child.
- **AC3.2** _When_ deleting `1105` (has children), _then_ `409` `CUENTA_CON_CUENTAS_HIJAS` and nothing
  is deleted.
- **AC3.3** _When_ deleting a code that does not exist (`9999`), _then_ `404` `CUENTA_NO_ENCONTRADA`.
- **AC3.4** _When_ the path code is not a valid account code (`abc`, `123`), _then_ `400`
  `VALIDACION_ENTRADA_FALLIDA` with `campo:"codigo"`.
- **AC3.5** _Given_ deleting the last child of a parent, _then_ the parent becomes a leaf
  (`tieneHijas:false`, `admiteMovimientos:true`) and becomes deletable.
- **AC3.6** UI: the «Eliminar» action is only offered on leaves. Activating it asks for inline
  confirmation («¿Eliminar 110510?» Confirmar / Cancelar); only «Confirmar» calls the API.

### 3.5 H4 — Estados de carga y de error

- **AC4.1** While the tree loads, the UI shows «Cargando catálogo…» (`role="status"`).
- **AC4.2** If loading fails, the UI shows the API's Spanish message (`role="alert"`) and a «Reintentar»
  button that reloads it.
- **AC4.3** While creating, the submit button reads «Creando…» and is disabled; fields are disabled.
- **AC4.4** If creating fails, field/form errors are shown (AC2.11) and the typed values are kept.
- **AC4.5** While deleting, the row's confirm button reads «Eliminando…» and is disabled.
- **AC4.6** If deleting fails, the API's message is shown as an alert near the tree and the tree is
  left unchanged.
- **AC4.7** If the server is unreachable, every operation shows
  «No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.» (`ERROR_RED`).

## 4. API & UI Contracts

Base path: `/cuentas`. JSON field names are Spanish (user-facing contract); code identifiers are English.

### 4.1 Types

```ts
type Naturaleza = "debito" | "credito";
type Nivel = "clase" | "grupo" | "cuenta" | "subcuenta";

interface CuentaNodo {
  codigo: string; // "110505"
  nombre: string; // "Caja general"
  nivel: Nivel;
  naturaleza: Naturaleza; // inherited from the class
  codigoPadre: string | null;
  tieneHijas: boolean;
  admiteMovimientos: boolean; // === !tieneHijas (R6)
  hijas: CuentaNodo[]; // ordered by codigo
}
```

### 4.2 Endpoints

| Method   | Path               | Body                                                          | Success                        | Errors                                                                                                                                                                     |
| -------- | ------------------ | ------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/cuentas`         | —                                                             | `200 CuentaNodo[]` (roots)     | `500`                                                                                                                                                                      |
| `POST`   | `/cuentas`         | `{ codigo: string; nombre: string; naturaleza?: Naturaleza }` | `201 CuentaNodo` (`hijas: []`) | `400 VALIDACION_ENTRADA_FALLIDA`, `404 CUENTA_PADRE_NO_ENCONTRADA`, `409 CODIGO_CUENTA_DUPLICADO`, `422 NATURALEZA_CUENTA_REQUERIDA`, `422 NATURALEZA_CUENTA_INCOMPATIBLE` |
| `DELETE` | `/cuentas/:codigo` | —                                                             | `204` (empty)                  | `400 VALIDACION_ENTRADA_FALLIDA`, `404 CUENTA_NO_ENCONTRADA`, `409 CUENTA_CON_CUENTAS_HIJAS`                                                                               |

### 4.3 Error envelope

```json
{
  "statusCode": 409,
  "code": "CODIGO_CUENTA_DUPLICADO",
  "message": "Ya existe una cuenta registrada con el código \"1105\".",
  "details": { "campo": "codigo", "valor": "1105" },
  "timestamp": "2026-11-21T23:22:39.000Z",
  "path": "/cuentas"
}
```

- Domain errors: `details` is an object `{ campo, valor }` (optional).
- Validation errors: `details` is an array `[{ campo, mensaje }]`, one entry per invalid field
  (first message per field).

### 4.4 Error codes used by this feature

| Code                             | HTTP | Mensaje (Spanish)                                                                                                                                |
| -------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VALIDACION_ENTRADA_FALLIDA`     | 400  | `Los datos enviados no son válidos.`                                                                                                             |
| `CODIGO_CUENTA_INVALIDO`         | 422  | `El código "{c}" no es válido. Debe tener solo dígitos y una longitud de 1, 2, 4 o 6.` (domain guard; HTTP validation normally catches it first) |
| `NOMBRE_CUENTA_INVALIDO`         | 422  | `El nombre de la cuenta debe tener entre 1 y 120 caracteres.` (domain guard)                                                                     |
| `CUENTA_NO_ENCONTRADA`           | 404  | `No se encontró la cuenta con el código "{c}".`                                                                                                  |
| `CUENTA_PADRE_NO_ENCONTRADA`     | 404  | `La cuenta padre "{p}" no existe. Créala antes de crear la cuenta "{c}".`                                                                        |
| `CODIGO_CUENTA_DUPLICADO`        | 409  | `Ya existe una cuenta registrada con el código "{c}".`                                                                                           |
| `CUENTA_CON_CUENTAS_HIJAS`       | 409  | `No se puede eliminar la cuenta "{c}" porque tiene cuentas hijas.`                                                                               |
| `NATURALEZA_CUENTA_REQUERIDA`    | 422  | `Las cuentas de nivel clase deben indicar su naturaleza (débito o crédito).`                                                                     |
| `NATURALEZA_CUENTA_INCOMPATIBLE` | 422  | `La naturaleza de la cuenta no es compatible con la de su cuenta padre: "{c}" hereda la naturaleza {débito/crédito}.`                            |
| `RECURSO_NO_ENCONTRADO`          | 404  | `No se encontró el recurso solicitado.` (unknown route)                                                                                          |
| `ERROR_INTERNO_SERVIDOR`         | 500  | `Ocurrió un error interno inesperado. Inténtalo de nuevo más tarde.`                                                                             |
| `ERROR_RED` (frontend only)      | —    | `No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.`                                                                |
| `RESPUESTA_INVALIDA` (frontend)  | —    | `El servidor envió una respuesta inesperada. Inténtalo de nuevo más tarde.` (response breaks the contract)                                       |

`CUENTA_CON_CUENTAS_HIJAS`, `NATURALEZA_CUENTA_REQUERIDA`, `CODIGO_CUENTA_INVALIDO`,
`NOMBRE_CUENTA_INVALIDO` and `RECURSO_NO_ENCONTRADO` extend the constitution's initial taxonomy.
`CUENTA_CON_SUBCUENTAS_ACTIVAS` is not used: there is no activation state in this feature, and
"subcuenta" is a level name here. Framework-level 4xx errors other than 404 (e.g. malformed JSON) keep
their status and are reported as `VALIDACION_ENTRADA_FALLIDA`.

### 4.5 HTTP validation messages (per field)

| Campo        | Condición              | Mensaje                                                            |
| ------------ | ---------------------- | ------------------------------------------------------------------ |
| `codigo`     | missing / not a string | `El código es obligatorio.`                                        |
| `codigo`     | wrong format           | `El código debe tener solo dígitos y una longitud de 1, 2, 4 o 6.` |
| `nombre`     | missing / blank        | `El nombre es obligatorio.`                                        |
| `nombre`     | > 120 characters       | `El nombre no puede superar los 120 caracteres.`                   |
| `naturaleza` | not in enum            | `La naturaleza debe ser "debito" o "credito".`                     |
| _unknown_    | property not allowed   | `La propiedad "{p}" no está permitida.`                            |

### 4.6 UI copy

- Title: «Catálogo de cuentas». Level badges: «Clase», «Grupo», «Cuenta», «Subcuenta».
  Nature labels: «Débito», «Crédito». Leaf hint: «Admite movimientos».
- Form title: «Nueva cuenta»; labels «Código», «Nombre», «Naturaleza»; submit «Crear cuenta».

## 5. Non-Functional Requirements

- **Persistence:** in-memory repository behind the `AccountRepository` port, one instance per Nest
  application (state resets on restart). Swappable for a DB adapter without touching domain/application.
- **Validation:** global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) with a
  Spanish `exceptionFactory`; domain guards duplicate format checks (defense in depth).
- **Errors:** global `@Catch()` filter, no stack traces in responses, unexpected errors logged with
  NestJS `Logger`.
- **Security:** CORS restricted to `WEB_ORIGIN`; `PORT`/`WEB_ORIGIN` validated at bootstrap.
- **Performance:** the catalog is small (hundreds of accounts); the full tree is returned in one call,
  built in O(n log n) (sort + single pass). No pagination.
- **Accessibility:** the tree follows the disclosure pattern (nested lists; each branch toggle is a
  `<button>` with `aria-expanded` + `aria-controls` and a label like «Expandir 1 Activo»). The ARIA
  `role="tree"` was deliberately avoided because it promises arrow-key navigation this feature does not
  implement. Status and alerts use `role="status"`/`role="alert"`; invalid fields use `aria-invalid` +
  `aria-describedby`.
