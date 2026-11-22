# Plan 001 — Catálogo de cuentas como árbol

## 1. Architecture & File Map

### Backend (`api/src/`)

```text
api/src/
├── main.ts                                   # MODIFY: env parsing, global pipe + filter, CORS
├── app.module.ts                             # MODIFY: imports AccountsModule only
├── app.controller.ts / app.service.ts        # DELETE (starter smoke endpoint)
├── shared/
│   ├── domain/
│   │   ├── error-code.ts                     # ERROR_CODES as const + ErrorCode union
│   │   └── domain.exception.ts               # DomainException base + FieldErrorDetail
│   └── infrastructure/
│       ├── env.config.ts                     # parseEnv(): PORT, WEB_ORIGIN (fail-fast)
│       ├── validation.ts                     # createValidationPipe() + Spanish exceptionFactory
│       ├── request-validation.exception.ts   # HTTP-layer exception carrying field details
│       ├── http-exception.filter.ts          # @Catch() global filter → error envelope
│       └── configure-app.ts                  # global pipe + filter, shared by main.ts and e2e
└── modules/accounts/
    ├── domain/
    │   ├── account-code.vo.ts                # AccountCode: format, level, parentCode
    │   ├── account-level.ts                  # ACCOUNT_LEVELS as const + AccountLevel
    │   ├── account-nature.ts                 # ACCOUNT_NATURES as const + AccountNature
    │   ├── account.entity.ts                 # Account: createClass / createChild / restore
    │   ├── account-tree.ts                   # buildAccountTree(): pure tree projection (R6)
    │   ├── account.errors.ts                 # Spanish domain exceptions
    │   └── account.repository.ts             # AccountRepository port + ACCOUNT_REPOSITORY token
    ├── application/
    │   ├── account.dto.ts                    # CreateAccountInput, AccountNodeOutput
    │   ├── account-node.mapper.ts            # AccountTreeNode → AccountNodeOutput
    │   ├── create-account.use-case.ts
    │   ├── list-account-tree.use-case.ts
    │   └── delete-account.use-case.ts
    ├── infrastructure/
    │   ├── accounts.module.ts                # factory DI wiring
    │   ├── http/
    │   │   ├── accounts.controller.ts        # GET/POST/DELETE /cuentas
    │   │   ├── create-account.request.ts     # class-validator DTO
    │   │   ├── parse-account-code.pipe.ts    # validates :codigo
    │   │   └── account.response.ts           # AccountNodeResponse (Spanish JSON)
    │   └── persistence/
    │       ├── in-memory-account.repository.ts
    │       ├── account.mapper.ts             # Account <-> AccountRecord
    │       └── seed-accounts.ts              # sample catalog
    └── testing/
        └── fake-account.repository.ts        # fake port + sample catalog (excluded from build)
```

Tests: `*.spec.ts` next to the code (domain, application, filter, env), `api/test/accounts.e2e-spec.ts`
(HTTP). The starter `app.e2e-spec.ts` / `app.controller.spec.ts` are deleted with the smoke endpoint.

### Frontend (`web/src/`)

```text
web/src/
├── main.tsx                                  # MODIFY: renders AccountsPage with real API client
├── App.tsx                                   # DELETE (starter smoke screen)
├── api.ts → api/config.ts                    # MOVE: apiUrl()
├── api/
│   ├── api-error.ts                          # ApiError + parseApiError(unknown) + ERROR_RED
│   ├── http-client.ts                        # request() over an injectable fetch
│   └── accounts-api.ts                       # AccountsApi interface + createAccountsApi() + parseNode
├── types/account.ts                          # AccountNode, AccountNature, AccountLevel, labels
├── components/
│   ├── Alert.tsx                             # role=alert / status
│   └── FieldError.tsx
├── test/
│   ├── setup.ts                              # Testing Library cleanup (globals are off)
│   └── account-fixtures.ts                   # node(), sampleTree(), deferred()
└── features/accounts/
    ├── account-tree.utils.ts                 # findNode, ancestorCodes, branchCodes, parentCodeOf
    ├── useAccountTree.ts                     # load state + expanded set + reload + reveal
    ├── useCreateAccount.ts                   # submit state + field errors
    ├── useDeleteAccount.ts                   # request → confirm flow, pending code, error
    ├── AccountTree.tsx / AccountTreeItem.tsx # disclosure-pattern nested lists
    ├── CreateAccountForm.tsx
    └── AccountsPage.tsx                      # composes hooks + components (receives AccountsApi)
```

## 2. DI & Ports Design

| Token / class            | Provided by                                                      | Consumers            |
| ------------------------ | ---------------------------------------------------------------- | -------------------- |
| `ACCOUNT_REPOSITORY`     | `useFactory: () => new InMemoryAccountRepository(SEED_ACCOUNTS)` | use cases            |
| `CreateAccountUseCase`   | `useFactory(repo)`, `inject: [ACCOUNT_REPOSITORY]`               | `AccountsController` |
| `ListAccountTreeUseCase` | idem                                                             | `AccountsController` |
| `DeleteAccountUseCase`   | idem                                                             | `AccountsController` |

`AccountRepository` port:

```ts
findAll(): Promise<ReadonlyArray<Account>>;
findByCode(code: AccountCode): Promise<Account | null>;
hasChildren(code: AccountCode): Promise<boolean>;
save(account: Account): Promise<void>;
delete(code: AccountCode): Promise<void>;
```

No `Clock`/`IdGenerator`/`UnitOfWork`: the code is the natural identity, there are no timestamps in the
model, and every use case performs a single write. Add them when a feature needs them.

Frontend: `AccountsPage` receives an `AccountsApi` prop; hooks receive the API as an argument; the HTTP
client receives `fetch` as a dependency. Tests inject fakes, no network.

## 3. Testing Plan

| Layer       | File                                                | Covers                                                                                        |
| ----------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Domain      | `account-code.vo.spec.ts`                           | R1, R2, R3, `CODIGO_CUENTA_INVALIDO`                                                          |
| Domain      | `account.entity.spec.ts`                            | R8, `NATURALEZA_CUENTA_REQUERIDA`, `NATURALEZA_CUENTA_INCOMPATIBLE`, `NOMBRE_CUENTA_INVALIDO` |
| Domain      | `account-tree.spec.ts`                              | ordering, nesting, R6 flags                                                                   |
| Application | `create-account.use-case.spec.ts`                   | R4, R7, inheritance, AC2.1–2.2, 2.7–2.10                                                      |
| Application | `delete-account.use-case.spec.ts`                   | R5, AC3.1–3.3, 3.5                                                                            |
| Application | `list-account-tree.use-case.spec.ts`                | AC1.1–1.2                                                                                     |
| Infra       | `http-exception.filter.spec.ts`                     | envelope, no leaks, status mapping                                                            |
| E2E         | `test/accounts.e2e-spec.ts`                         | every endpoint, status and error code in spec §4                                              |
| Web         | `api/api-error.spec.ts`, `api/accounts-api.spec.ts` | envelope parsing, network error, response guards                                              |
| Web         | `features/accounts/account-tree.utils.spec.ts`      | helpers                                                                                       |
| Web         | `features/accounts/AccountsPage.spec.tsx`           | AC1.3–1.6, AC2.11–2.14, AC3.6, AC4.1–4.7 with fake `AccountsApi`                              |

## 4. Tooling changes

- `api`: add `class-validator`, `class-transformer` (required by Nest's `ValidationPipe`).
- `web`: add `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event`;
  `test` script `vp test run`; `test` block in `web/vite.config.ts` (`environment: "jsdom"`).
- Constitution hardening backlog: `"strict": true` in `web/tsconfig.app.json`;
  `typescript/no-explicit-any: "error"` for `api/**`.

## 5. Open Decisions / Trade-offs (resolved defaults)

1. **Tree built on the server.** The hierarchy and R6 are domain knowledge, so the backend returns the
   nested tree; the UI only renders it. Re-fetch after every mutation keeps the client simple.
2. **No client-side validation duplication.** The server is the single source of truth for errors;
   the UI maps `details[].campo` to fields. Only the nature selector visibility is computed locally.
3. **Nature on non-classes is optional** and must match the parent when sent (instead of rejecting any
   value), so a client that always sends the field still works.
4. **Delete confirmation inline** instead of `window.confirm`, to keep it accessible and testable.
5. **Seeded in-memory store** so the UI is usable on first run; data resets on API restart.
