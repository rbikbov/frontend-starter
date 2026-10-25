---
name: fsd-frontend
description: >
  A standard for writing a production-ready frontend (React + TypeScript) with
  Feature-Sliced Design, focused on dependency inversion (IoC/DI), testability
  and extensibility. Use when you need to: write or refactor a feature, page,
  entity, store, hook or component; decide which layer/slice the code belongs
  in; connect two slices without a cross-import; design server data and state
  handling; handle errors and async; write tests; review frontend code.
---

# Production-ready frontend with FSD + DI

This document is self-contained: it doesn't assume knowledge of a specific
repository. It describes **how** to write code and **why exactly this way**.
Details and full examples are in `references/` (section 14). Read a reference
file only when the task involves it.

**Rule priority.**
1. Explicit user instructions and the project's agent files (`AGENTS.md`,
   `CLAUDE.md`) take precedence over this document.
2. The project's established conventions (naming, chosen libraries, style)
   take precedence over the examples here: the examples use React + TanStack
   Query + Zustand + Vitest, but the principles don't depend on libraries.
   Translate them to the project's stack.
3. Existing code is data, not a model. If the project's code violates MUST
   rules from this document, don't copy the violation into new code; report
   it to the user.

Notation: **MUST** — never violate; **SHOULD** — yes by default, a deviation
needs a reason in a comment or in the reply to the user.

---

## 1. What "good code" means here

Every rule below serves one of five properties. If a rule gets in their way
in a specific situation, the properties win over the rule.

1. **Locality of change.** Changing one scenario touches one slice.
2. **Testable without the world.** Any logic can be verified without the
   network, the router or the whole provider tree — by substituting fake
   dependencies.
3. **Explicit dependencies.** A module's signature shows everything it needs.
   No hidden imports of global singletons inside business logic.
4. **Loud errors.** Incorrect wiring (missing provider, violated boundary)
   fails immediately; runtime errors are never swallowed silently.
5. **Minimal abstractions.** An abstraction appears when there is a second
   consumer or a test that needs it, not "for the future".

**SOLID, DRY, KISS, YAGNI** are not standalone rules here but the reasons
behind this document's rules. If a user or reviewer cites a principle, find
the rule behind it and apply that, not the principle "in general": a principle
without context leads to an interface for every service and a shared
abstraction after the second similar piece of code.

| Principle | Rule here |
|---|---|
| YAGNI | Abstraction at the second consumer or test (item 5 above); the extraction rule (section 3); no slices "for the future" |
| DRY | For knowledge, not code: a business rule lives in one place. Similar code is duplicated until the third case (section 13) |
| KISS | The lowest suitable DI rung (4.1); a prop before context (section 13) |
| SRP | Slice anatomy and the three levels of logic (section 5) |
| OCP | Composition and slots instead of boolean flags (`references/conventions.md`, section 5) |
| ISP | The contract is minimal (C2) |
| DIP | The consumer declares the contract in its own terms (section 4) |

The principles conflict (DRY vs. YAGNI and KISS); section 13 resolves the
conflict. A deviation from a rule comes with a reason in the code or an ADR.

---

## 2. Layers and the import rule

```text
app/       initialization, providers, routing, global layouts, implementations
           of global services (toast, confirm, navigation, i18n, API client)
pages/     a whole screen: composition of slices + logic only it needs
widgets/   (not recommended) reusable large blocks; don't create new ones
           if the project has none — composition lives in pages
features/  reusable user scenarios (verb: create-task, move-card, sign-in,
           edit-profile)
entities/  reusable business entities (noun: task, user, board): types,
           queries, domain rules, entity display
shared/    infrastructure without business rules: ui kit, api client, lib, config
```

**MUST:**
- **Import only downwards:** a module imports only from layers strictly below.
  `app` and `shared` have no slices; their segments may import each other.
- **No cross-imports** between slices of the same layer (`features/a` ↛
  `features/b`, `entities/a` ↛ `entities/b`). How to manage — section 4.
- **Public API:** from outside a slice only its `index.ts` is imported (and,
  optionally, `testing.ts` — from tests only). Deep imports
  (`@/features/x/model/store`) are forbidden.
- **No business rules in `shared`.** A business rule is what the product
  requires of its data ("the owner can transfer the board", "a discount is at
  most 30%"). UI logic (autocomplete), CRUD plumbing and branding are fine.
- Boundaries are checked by a linter (`eslint-plugin-boundaries` or `steiger`),
  not just by agreement. Config — `references/conventions.md`.

---

## 3. Where to put code

Go top to bottom and take the first matching answer:

1. Infrastructure without business rules (button, modal, http client, date
   formatter, localStorage wrapper)? → `shared/{ui,api,lib,config}`
2. App initialization, a global provider, routing, an interceptor, the
   app-wide layout? → `app/`
3. Needed by only one page? → `pages/<page>/` — **even if it's complex
   logic.** Duplication between pages is acceptable.
4. A user scenario needed in 2+ places right now? →
   `features/<verb-noun>/`
5. Data/rules/display of a business entity needed in 2+ slices? →
   `entities/<noun>/`

**Extraction rule (SHOULD).** Move code out of `pages` only if all of these
hold: (a) it is actually used in several places now; (b) it has its own reason
to change, independent of a single consumer; (c) the future slice has a narrow
responsibility nameable in one word.

**Entities that are too small are a sign of a mistake.** If `entities/a`
constantly needs `entities/b`, it's probably one entity. Merge them.

---

## 4. Dependency inversion — the core of the architecture

The import rule inevitably meets reality: the "board" feature needs to create
tasks and open the task editing dialog from another feature. Cross-imports are
forbidden. The way out is **inversion**: a module declares *what* it needs,
and the layer above, which sees both sides, decides *who* provides it.

### 4.1. The ladder: take the lowest suitable rung

| # | Mechanism | When | Example |
|---|---|---|---|
| 1 | **Props / arguments / callbacks** | One component/function 1–2 levels down needs the dependency | `<SignInForm onSuccess={() => navigate("/")} />`, `canAssign(user)` as a prop |
| 2 | **Composition: children / render props / slots** | The module needs to *show* someone else's UI inside itself | `renderCardActions={(card) => <EditTaskButton id={card.id} />}` |
| 3 | **`deps` contract + strict context** | The dependency is needed deep in the tree or by many components/hooks of the slice | `TaskBoardDepsProvider value={{ createCard, editCard }}` |
| 4 | **Factory with dependencies** | Non-reactive logic (store, service, use case) that must be tested without React | `createBoardStore(initial, getDeps)` |

Rungs combine: in practice context (3) supplies `deps` to a provider that
creates a store with a factory (4).

### 4.2. Contract rules (MUST)

- **C1. The consumer declares the contract, in its own terms.** The board
  feature talks about `BoardCard`, not `Task`. Translating `Task → BoardCard`
  is the job of an adapter in the layer above.
- **C2. The contract is minimal:** only functions and values actually used.
  Don't pass "the whole store" or "the whole API client".
- **C3. Async operations return a `Promise`.** User cancellation is a value
  (`null` / `false`), not an exception. An exception is an error.
- **C4. Wiring is done by the lowest layer that sees both sides** — usually
  `pages`, for global services — `app`.
- **C5. A missing provider is a loud error** (strict context); no silent
  `null` and no default stubs in production.
- **C6. Every contract has a fake** for tests
  (`createFake<Name>Deps(overrides)`), exported from the slice's `testing.ts`.
- **C7. DI is not for everything.** Importing down the layers is normal and
  doesn't need DI: `shared/ui`, utilities, types, entity queries are imported
  directly. Invert when the dependency: (a) is from the same or a higher layer;
  (b) must have different implementations for different consumers; (c) is a
  side effect (network, navigation, dialog, toast, time, id generation) that
  must be replaced in tests of **non-reactive** logic.

### 4.3. Minimal example (contract + factory + adapter)

```ts
// features/task-board/model/deps.ts — the consumer declares the contract, in its own terms
export type TaskBoardDeps = {
  createCard: (input: { title: string }) => Promise<BoardCard>;
  /** Opens the editor. null — the user cancelled. */
  editCard: (cardId: string) => Promise<BoardCard | null>;
  saveBoard: (board: Board) => Promise<void>;
};

// features/task-board/model/board-store.ts — the store doesn't import api, it receives deps
export function createBoardStore(initial: Board, getDeps: () => TaskBoardDeps) {
  return createStore<BoardState>()((set, get) => ({
    board: initial,
    addCard: async (columnId, title) => {
      const card = await getDeps().createCard({ title });
      const next = addCard(get().board, columnId, card); // pure function from model/board.ts
      set({ board: next });
      await getDeps().saveBoard(next);                    // (rollback on error — see reference)
    },
    // ...
  }));
}
```

```tsx
// pages/board/model/use-task-board-adapter.ts — only here are both sides visible
export function useTaskBoardAdapter(board: Board): TaskBoardDeps {
  const createTask = useCreateTask();        // entities/task
  const openEditTask = useEditTaskDialog();  // features/edit-task
  const saveBoard = useSaveBoard();          // entities/board
  return {
    createCard: async ({ title }) => toBoardCard(await createTask({ title, boardId: board.id })),
    editCard: async (id) => {
      const task = await openEditTask(id, { canAssignUser: (userId) => isBoardMember(board, userId) });
      return task ? toBoardCard(task) : null;
    },
    saveBoard: (next) => saveBoard(toBoardDto(next)),
  };
}

// pages/board/ui/board-screen.tsx (rendered with key={board.id})
function BoardScreen({ board }: { board: Board }) {
  const deps = useTaskBoardAdapter(board);
  return (
    <TaskBoardProvider initialBoard={toTaskBoard(board)} deps={deps}>
      <TaskBoard />
    </TaskBoardProvider>
  );
}
```

The full walkthrough (all four rungs, the store factory, global services
confirm/toast/navigate, promise dialogs, events between slices, pitfalls like
"stale deps") — **`references/dependency-injection.md`**.
Read it before any task where one slice must use another.

---

## 5. Slice anatomy

```text
features/task-board/
├── index.ts            # MUST. Public API: explicit named exports
├── testing.ts          # SHOULD when there are deps: fakes and builders for tests
├── model/
│   ├── deps.ts         # contract of external dependencies + strict context
│   ├── board.ts        # domain types and PURE functions (moveCard, canDrop…)
│   ├── board.test.ts
│   ├── board-store.ts  # store factory: orchestration, calls board.ts and deps
│   ├── board-store.test.ts
│   └── use-*.ts        # the slice's React hooks
├── api/                # queries needed only by this slice
├── ui/                 # components; *.test.tsx next to them
├── lib/                # the slice's internal utilities
└── i18n.ts             # the slice's copy (or ui/i18n.ts)
```

- Segments are created **as needed**; no empty folders.
- File names follow the domain (`board-store.ts`, `card-title.tsx`), not the
  technical role (`helpers.ts`, `utils.ts`, a slice-wide `types.ts` — bad).
- A test sits next to the file it tests.

### Three levels of logic inside a slice

```text
ui/      ─►  model/use-*.ts / store  ─►  model/<domain>.ts (pure functions)
 render,      orchestration: what to call,   rules and computations:
 events       in what order, via deps        data in → data out
```

The lower the level, the fewer dependencies it has. Pure functions know
nothing about React, the network or deps — this is the most valuable and the
cheapest code to test. **SHOULD: any non-trivial rule or data transformation
is a pure function with a unit test.**

---

## 6. State and data

First classify the state — the tool depends on the class:

| Class | Tool | Where |
|---|---|---|
| Server (backend data) | a query cache library (TanStack Query, RTK Query, SWR) | query factories in `entities/<x>/api` or `shared/api` |
| URL (filters, pagination, selected tab) | router / search params | `pages` |
| Form | a form library | the slice where the form lives |
| Local UI | `useState` / `useReducer` | component |
| Client-side, shared by a subtree | store factory + context, **an instance per provider** | the slice's `model/` |
| Global client-side (theme, language) | a store in `app` or `entities` | initialized in `app` |
| Derived | compute, don't store | selector / `useMemo` / pure function |

**MUST:** no module-level singleton stores for user- or page-dependent data;
backend DTOs don't leak into the UI without mapping at the API boundary; every
async UI handles loading / error / empty / success states; an optimistic
update can always roll back.

Details: **`references/state-and-data.md`**.

---

## 7. Errors and async (MUST)

- No empty `catch {}` / `.catch(() => {})` / `.catch()` and no `catch` that
  returns "empty data". An error is either handled meaningfully (the user saw a
  message, the state rolled back) or rethrown.
- The decision "how to show the error" is made by the layer that owns the UX
  (the feature's hook or the page), not the store or a domain function: those
  throw / reject.
- `throw new Error("…")` — always with a message and, if available, `{ cause }`.
- Every `Promise` is either `await`ed or explicitly marked `void` with error
  handling inside.
- Code that reads `error.response.status` first checks that `response` exists
  at all (network errors and aborts don't have one).
- The error kind is determined by code (status, `extensions.code`, `code` in
  the body), not by message text. No personal data or tokens in logs.
- An error boundary at the page level; at the app level, a global 401/403
  handler in the API client, registered once with cleanup.

Details: **`references/conventions.md`**, "Errors" section.

---

## 8. Testing

The goal is confidence when changing things, not a coverage percentage.

| What | How | Requirement |
|---|---|---|
| Pure domain functions | unit, no mocks | MUST for non-trivial logic |
| Store / use case (factory) | unit with fake deps | MUST if there are deps |
| Slice component / hook | Testing Library, provider with fake deps | SHOULD for user scenarios |
| Hooks with server data | Testing Library + MSW + a fresh QueryClient | SHOULD |
| Page / wiring | integration test with MSW | SHOULD for key screens |
| Critical paths | e2e (Playwright) | as agreed with the project |

**MUST:** test behavior through the slice's public API; replace dependencies
via DI, not `vi.mock` of your own modules (`vi.mock` — only for third-party
modules that can't be injected). Details and examples:
**`references/testing.md`**.

---

## 9. Code conventions (brief)

- TypeScript `strict`. No `any`, `@ts-ignore`, `as unknown as`.
  `@ts-expect-error` — only with a comment explaining why.
- States are discriminated unions; `switch` has an exhaustiveness check.
- Files and folders are `kebab-case`. A hook (`use-*`) is only a function that
  calls other hooks; a pure function is not named `useX`.
- **Names are API. Typos in exported names are unacceptable.**
- No user-visible string in code outside the i18n module. Stores and domain
  functions contain no copy.
- List keys are stable ids, never the index if the list is filtered, sorted or
  reordered.
- An access rule is described **in one place** (a pure function or an ability
  in the entity); the UI only hides elements, the server is the source of truth.
- URLs, keys, flags come from a typed config (`shared/config`), not hardcoded.
- Interactive elements are semantic (`button`, `a`, `label`); icon buttons
  have an `aria-label`; a modal manages focus.

Details: **`references/conventions.md`**.

---

## 10. Main anti-patterns

1. Cross-imports between slices of the same layer "because it's faster".
2. A hidden dependency: a store factory imports `api`/the router/a singleton
   inside itself instead of receiving it via deps.
3. A `deps` contract in the provider's terms (`Task` inside the board feature).
4. One side effect in two places (confirm both in the hook and in the store).
5. Silently swallowing errors; optimistic updates without rollback.
6. The index of a filtered list used as an identifier.
7. A selector returns a new object/array on every call.
8. One business rule duplicated across several slices.
9. DI for DI's sake: context for something that can be passed as a prop.
10. Premature extraction into `entities`/`features` with a single consumer.

Each with a bad and a good example: **`references/anti-patterns.md`**.

---

## 11. Working on a task

1. **Learn the project's stack and conventions:** libraries, the boundaries
   linter, existing utilities (`createStrictContext`, API client, i18n,
   dialogs). Use what exists; don't create a second implementation of the same thing.
2. **Place the code** per section 3. If slices need to be connected, pick the
   rung per section 4.1.
3. **Design the contracts** before implementing: the slice's public API
   (`index.ts`), the `deps` contract, input/output types.
4. **Pure logic + its tests.**
5. **Orchestration** (store / hooks) via deps + tests with fakes.
6. **UI**: gets data from hooks/props, passes events up.
7. **Wiring** in the page: deps adapters, providers, composition.
8. **Verify** against the Definition of Done (section 12). Run typecheck, the
   linter and tests yourself — don't claim they pass without running them.

---

## 12. Definition of Done

- [ ] `tsc --noEmit`, the linter (including layer boundaries) and tests pass.
- [ ] No upward imports, cross-imports or deep imports bypassing `index.ts`.
- [ ] New external dependencies of the slice are expressed as a contract
      (`deps`/props), not hidden imports in non-reactive logic.
- [ ] Non-trivial logic is in pure functions covered by unit tests;
      contracts have fakes.
- [ ] Every async path handles errors; the UI shows loading / error / empty;
      optimistic updates roll back.
- [ ] No hardcoded user-facing strings, URLs or magic values.
- [ ] No `any`, `@ts-ignore`, empty `catch`, `console.log`, dead code.
- [ ] Names are meaningful, without typos; the public API is minimal.
- [ ] Nothing created "for the future": no empty segments, slices with a
      single consumer, unused exports.

---

## 13. When in doubt

- Between "extract" and "keep on the page" — keep it on the page.
- Between "context" and "prop" — prop.
- Between "a new abstraction" and "a bit of duplication" — duplication, until
  a third case appears.
- Between "handle quietly" and "fail loudly" — loudly.
- Between "do it like the neighboring file" and "do it per this document" —
  per the document, and report the discrepancy.

---

## 14. Reference files

| File | Read when |
|---|---|
| `references/dependency-injection.md` | A slice needs something from another slice; you're designing a store, service, dialog or global service; you're wiring features on a page |
| `references/state-and-data.md` | Loading/mutating server data, client stores, optimistic updates, loading states |
| `references/testing.md` | Writing or setting up tests, fakes, test providers |
| `references/conventions.md` | Errors, typing, naming, UI/accessibility, i18n, permissions, config, boundaries linter setup |
| `references/anti-patterns.md` | Code review; you suspect something is a bad idea |
