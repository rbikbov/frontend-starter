# Code conventions

## Contents

1. Errors
2. TypeScript
3. Naming
4. Public API and imports
5. Components and effects
6. Accessibility (a11y)
7. Copy and i18n
8. Access control
9. Configuration and module side effects
10. Comments
11. Boundaries linter and useful rules
12. Performance

---

## 1. Errors

### 1.1. Error model

All API errors are normalized **once**, at the `shared/api` boundary, into a
single type. The rest of the code doesn't parse `axios`/`fetch` errors.

```ts
// shared/api/app-error.ts
export type AppErrorKind =
  | "network"        // no connection, timeout, CORS
  | "unauthorized"   // 401
  | "forbidden"      // 403
  | "not-found"      // 404
  | "validation"     // 400/422 with field errors
  | "conflict"       // 409, stale version
  | "aborted"        // request aborted — don't show to the user
  | "unknown";

export class AppError extends Error {
  constructor(
    readonly kind: AppErrorKind,
    message: string,
    readonly details: { status?: number; fieldErrors?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = "AppError";
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (isAbortError(error)) return new AppError("aborted", "Request aborted", { cause: error });
  if (isHttpError(error)) {
    if (!error.response) return new AppError("network", "Network error", { cause: error });
    return fromStatus(error.response.status, error);
  }
  return new AppError("unknown", error instanceof Error ? error.message : String(error), { cause: error });
}
```

### 1.2. Who is responsible for what

| Level | What it does with an error |
|---|---|
| Pure function | throws an `Error` with a clear message when an invariant is violated |
| Store / service | rolls back its own state and **rethrows** |
| Feature hook (UX owner) | shows it to the user (toast / inline message / field errors), reports the unexpected |
| Page | error boundary + a load error state with "Retry" |
| `app` | global 401 (sign-out/redirect) and 403, reporting unhandled errors |

### 1.3. Rules (MUST)

- No empty `catch`, `.catch(() => {})`, `.catch()` without a handler (the last
  one catches nothing — the error still becomes an unhandled rejection).
- No `catch` that returns "empty data" and disguises a failure as the absence
  of data.
- The user sees a **translated** message based on `kind`, not the server's
  `error.message`.
- `aborted` is not shown to the user.
- Unexpected errors go to monitoring through the `reportError(error)` port from
  `shared/lib/monitoring` (implemented in `app`).
- **Personal data and secrets never reach logs or monitoring:** email, phone,
  name, tokens, passwords, whole request bodies. Log entity ids, the error
  `kind`, the operation name. This includes "debug" logs in form handlers.
- **The error kind is determined by code, not text:** HTTP status,
  `extensions.code` in GraphQL, a `code` field in the response body. If the
  backend returns only text, text matching lives in a single mapper in
  `shared/api`, with a comment explaining why and a test for every string.
- A response with an errors array is checked as a whole (`errors.some(...)`),
  not by `errors[0]`.
- Throw an `Error`/`AppError`, not an object literal (`throw { status }`): a
  literal has no stack, and `instanceof` doesn't work on it.
- `throw new Error("…")` — always with a message; when wrapping — `{ cause }`.
- Global handlers (interceptors) are registered once and removed on unmount:

```tsx
// app/providers/api-error-handling.tsx
export function ApiErrorHandling({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const resetSession = useResetSession();
  const onUnauthorized = useEventCallback(() => {
    resetSession();
    navigate(routes.signIn());
  });

  useEffect(() => {
    const id = apiClient.interceptors.response.use(undefined, (error: unknown) => {
      const appError = toAppError(error);
      if (appError.kind === "unauthorized") onUnauthorized();
      return Promise.reject(appError);
    });
    return () => apiClient.interceptors.response.eject(id);
  }, [onUnauthorized]);

  return children;
}
```

---

## 2. TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess` (index/key access returns
  `T | undefined` — catches the "element not found" class of bugs).
- Forbidden: `any`, `@ts-ignore`, `as unknown as X`, non-null `!` without
  proof on the neighboring line. `@ts-expect-error` — only with a comment
  explaining why.
- `unknown` for data of unknown shape + type narrowing.
- Impossible states are unrepresentable: discriminated unions instead of sets
  of optional fields.
- Exhaustive `switch`:

```ts
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

switch (error.kind) {
  case "network": return t("errors.network");
  // ...
  default: return assertNever(error.kind);
}
```

- Types are derived from the source of truth, not duplicated:
  `ReturnType`, `z.infer`, `typeof CONST[number]`, generated DTOs.
- `satisfies` for configs and dictionaries, to check the shape while keeping
  the exact type.
- Type imports — `import type`.
- A slice's public functions have explicit parameter and return types.

---

## 3. Naming

- **Names are API.** A typo in an exported name (`Ablity`, `useApplay…`)
  spreads across the codebase. Check the spelling.
- Files and folders are `kebab-case`: `board-store.ts`, `task-card.tsx`.
- Slices: `entities` — a noun (`task`, `board`); `features` — verb + object
  (`edit-task`, `move-card`, `sign-in`); `pages` — a screen (`board`,
  `settings`). Name by scenario, not by position on the screen (`sign-out`,
  not `header-menu`).
- Files follow the domain (`board.ts`, `access.ts`), not the role
  (`utils.ts`, `helpers.ts`, `types.ts`, `constants.ts` for the whole slice).
- Components are `PascalCase`; hooks are `useX` and **only** if they call
  other hooks (the pure function `canAccess(board, user)` is not named
  `useCanAccess`).
- Booleans — `is/has/can/should`: `isPending`, `canEdit`.
- Event props — `onX` (`onSave`), internal handlers — `handleX`.
- Factories — `createX`, adapters — `useXAdapter`, fakes — `createFakeX`,
  test data builders — `buildX`, mappers — `mapX` / `toX`.
- No abbreviations except common ones (`id`, `url`, `dto`, `api`).

---

## 4. Public API and imports

- A slice's `index.ts` has explicit named exports; `export *` is not used
  (except for a generated API client in `shared/api`).
- Export the minimum: what consumers actually need. Internal hooks, stores and
  subcomponents stay inside.
- Types — `export type { … }`.
- `testing.ts` is a second public API, for tests only.
- Within a slice — relative imports; between slices and layers — the
  `@/layer/slice` alias.
- `shared` has no layer-wide `index.ts`: import by segment
  (`@/shared/ui/button`, `@/shared/lib/react`) — fewer cycles and less unused
  code in the bundle.

---

## 5. Components and effects

**`shared/ui` components:** no business logic or data loading; controlled
(value + `onChange`); accept `className` and forward `ref`/native attributes;
variants via enum props (`variant="primary"`), not a dozen boolean flags.

**Slice components:**
- Thin: data from hooks/props, logic in `model/`. A component over ~150 lines
  or with several responsibilities — split it.
- No "smart" leaves: a list item receives data via props instead of looking it
  up in a global store on every row.
- Composition over configuration: `children`/slots instead of `showHeader`,
  `headerText`, `headerIcon`, …
- Conditional rendering without traps: `count > 0 && …`, not `count && …`.
- **State that the DOM changes without React events is not duplicated in
  `useState`.** Browser autofill and `form.reset()` in an uncontrolled form
  change `value` without `onChange`, and a `hasValue` flag set in `onChange`
  goes out of sync. For styling ("field is filled", a floating label) use CSS:
  `:placeholder-shown`, `:autofill`, `:focus-within`, in Tailwind —
  `has-[…]`/`group-has-[…]` or your own `@custom-variant`.
- **Keys are stable ids**, never the index if the list is filtered, sorted or
  dragged.
- **An index in a filtered/sorted view is not a coordinate in the source
  data.** Address operations (move, delete) by id.

**Effects (`useEffect`)** — only for synchronizing with external systems
(subscriptions, DOM, third-party widgets, sockets). Not for: computing derived
values (compute in render / `useMemo`), reacting to a user event (do it in the
handler), loading data (query cache). Every subscription has a cleanup.
Unstable functions inside an effect go through `useEventCallback`/`useLatest`,
not by suppressing `exhaustive-deps`.

---

## 6. Accessibility (a11y)

- Semantics: `button` for actions, `a` for navigation, a `label` for every
  field, headings in hierarchy, tables for tabular data.
- Icon buttons have an `aria-label` (translated).
- Modals: focus moves inside on open and returns on close, `Esc` closes, the
  background is inert (use a ready primitive from `shared/ui` or a headless library).
- Everything doable with a mouse is doable with a keyboard (including
  drag&drop — either a library with keyboard support or alternative actions).
- Field errors are linked to the field (`aria-describedby`, `aria-invalid`).
- Color is not the only carrier of meaning.

Good accessibility simplifies tests: elements are found by role and name.

---

## 7. Copy and i18n

- No user-visible string outside translation modules — including
  `aria-label`, `title`, `placeholder`, confirmation and toast texts.
- Stores and domain functions contain no copy; if a message is needed, they
  return a code/`kind` and the UI translates it.
- Translations live next to the slice (`<slice>/i18n.ts` or `ui/i18n.ts`),
  keys namespaced by slice.
- Interpolation and pluralization via i18n, not string concatenation.
- Dates, numbers, currencies — via `Intl`/i18n formatters with the current locale.

---

## 8. Access control

- **Every rule is described in one place** — as pure functions in the model of
  the entity it belongs to:

```ts
// entities/board/model/access.ts
export const isBoardOwner = (board: BoardAccess, userId: string) => board.ownerId === userId;
export const isBoardMember = (board: BoardAccess, userId: string) =>
  isBoardOwner(board, userId) || board.editorIds.includes(userId);
export const canManageBoardAccess = isBoardOwner;
```

  If the project uses a permissions library (CASL etc.), the ability is built
  in one place (`entities/session` or `app`), and slices get it through a
  hook/context instead of redefining the rules.
- A feature that needs a check from another domain receives it via a prop or
  `deps` (`canAssignUser`) rather than importing someone else's feature.
- The UI only hides/disables what's unavailable. The server is the source of
  truth; a 403 response is still handled.

---

## 9. Configuration and module side effects

- Environment variables are read **in one place** (`shared/config/env.ts`),
  validated at startup and exported as a typed object. `process.env` /
  `import.meta.env` are forbidden in the rest of the code.
- API URLs, websockets, service keys, flags — only from the config. Secrets
  don't reach the client bundle; a `.env` with real values isn't committed
  (`.env.example` is).
- **Importing a module has no side effects**: it doesn't write to `window`,
  subscribe to events, open connections or register interceptors. All of that
  is explicit initialization in `app` with cleanup.
- No mutable module-level singletons for user data.

---

## 10. Comments

- A comment explains **why** (a constraint, a non-obvious decision, a link to a
  bug/task), not **what** — "what" should be clear from the names.
- JSDoc — on the slice's public API and on `deps` contracts where the
  semantics aren't obvious from the type (what `null` means, who shows the
  confirmation).
- `TODO` — with a reason and a link to a task.
- Commented-out code is deleted.
- A deliberate deviation from this document's rules (for example, a
  cross-import) comes with a comment explaining why.

---

## 11. Boundaries linter and useful rules

Layer boundaries must be checked automatically. Options:

- **Steiger** — the official FSD linter: `npx steiger ./src`.
- **eslint-plugin-boundaries** — rules in ESLint. The example below is for
  versions 5–6. In version 7 the `element-types` and `entry-point` rules were
  replaced by a single `boundaries/dependencies` with policies; a verified v7
  config is in `frontend-bootstrap` (`references/configs.md`, ESLint section)
  and in the `frontend-starter` template. Check the docs of the installed version:

```js
// eslint.config.js (fragment)
import boundaries from "eslint-plugin-boundaries";

const slices = ["pages", "widgets", "features", "entities"];
const sameSlice = (type) => [type, { slice: "${from.slice}" }];

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "import/resolver": { typescript: true },
      "boundaries/elements": [
        { type: "app", pattern: "src/app" },
        ...slices.map((type) => ({ type, pattern: `src/${type}/*`, capture: ["slice"] })),
        { type: "shared", pattern: "src/shared" },
      ],
    },
    rules: {
      // import only downwards; anything within its own slice
      "boundaries/element-types": ["error", {
        default: "disallow",
        rules: [
          { from: "app", allow: ["app", ...slices, "shared"] },
          { from: "pages", allow: [sameSlice("pages"), "widgets", "features", "entities", "shared"] },
          { from: "widgets", allow: [sameSlice("widgets"), "features", "entities", "shared"] },
          { from: "features", allow: [sameSlice("features"), "entities", "shared"] },
          { from: "entities", allow: [sameSlice("entities"), "shared"] },
          { from: "shared", allow: ["shared"] },
        ],
      }],
      // from outside a slice — only via index.ts
      "boundaries/entry-point": ["error", {
        default: "disallow",
        rules: [
          { target: slices, allow: "index.(ts|tsx)" },
          { target: ["shared", "app"], allow: "**" },
        ],
      }],
    },
  },
  {
    // slices' testing.ts — from tests only
    files: ["src/**/*.{test,spec}.{ts,tsx}", "src/shared/lib/test/**"],
    rules: {
      "boundaries/entry-point": ["error", {
        default: "disallow",
        rules: [
          { target: slices, allow: ["index.(ts|tsx)", "testing.(ts|tsx)"] },
          { target: ["shared", "app"], allow: "**" },
        ],
      }],
    },
  },
];
```

Rules that mechanically catch mistakes described in this document:

| Rule | Catches |
|---|---|
| `@typescript-eslint/no-floating-promises` | missing `await` / an unhandled Promise |
| `@typescript-eslint/no-misused-promises` | an async function where void is expected (handlers) |
| `@typescript-eslint/no-explicit-any` | `any` |
| `@typescript-eslint/switch-exhaustiveness-check` | a non-exhaustive `switch` over a union |
| `@typescript-eslint/consistent-type-imports` | mixing types and values in imports |
| `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps` | hook mistakes, stale closures |
| `no-restricted-syntax` / `no-restricted-properties` on `process.env` outside `shared/config` | reading env in arbitrary places |

---

## 12. Performance

- Don't optimize up front: `memo`/`useMemo`/`useCallback` — when there is a
  measured problem, the contract needs reference stability (deps in context,
  effect dependencies), or the computation is genuinely expensive. If the
  project uses the React Compiler, manual memoization is usually unnecessary.
- Store selectors return stable references (`state-and-data.md`, 6.3).
- Long lists (hundreds+ items) — virtualization.
- Code is split by page (lazy imports at the routing level); heavy, rarely used
  features (editors, charts) are lazy within the page.
- Images — with dimensions and lazy loading.
