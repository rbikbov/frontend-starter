# Testing

Examples use Vitest, Testing Library, user-event, MSW, TanStack Query. The
principles are the same for Jest and other runners.

## Contents

1. Principles
2. What to test at each level
3. Infrastructure: setup, test providers, MSW
4. Fakes and data builders: `testing.ts`
5. Pure functions
6. Stores and services with dependencies
7. Slice components and hooks
8. Server data
9. Page and adapters
10. What not to do
11. Checklist

---

## 1. Principles

- **A test checks behavior through the public interface**: function input →
  output; a user action → what they see, and which dependencies were called.
  Not internal state and not private functions.
- **Dependencies are replaced via DI**, not via `vi.mock` of your own modules.
  If code can't be tested without `vi.mock("@/shared/api")`, that's a signal
  the dependency is hidden; fix the code (DI reference, section 5). `vi.mock`
  is acceptable for third-party modules that can't be injected.
- **Determinism.** Time, ids, random are injected or pinned
  (`vi.useFakeTimers()`, `createId` in deps). Never a real network.
- **One test — one behavior.** The test name describes the behavior:
  `"rolls back the board when saving fails"`, not `"test moveCard 2"`.
- **Arrange / Act / Assert**; shared arrange goes into a `setup()` function,
  not a `beforeEach` with mutable variables.
- The test sits next to the file: `board.ts` → `board.test.ts`.

---

## 2. What to test at each level

| Level | Test type | Replacing dependencies | What to check |
|---|---|---|---|
| `model/<domain>.ts` (pure functions) | unit | not needed | rules, edge cases, input immutability |
| Store / service factory | unit | fake `deps` | order of deps calls, resulting state, rollback on error, cancellation |
| Slice hook / component | Testing Library | the slice's provider with fake deps + test services | user scenario: click → what's visible, what was called |
| Server data hooks | Testing Library | MSW + a fresh QueryClient | DTO mapping, error handling, invalidation |
| Page adapter | unit / renderHook | fakes of lower hooks or MSW | type mapping, correct wiring |
| Page | integration | MSW | the screen's key scenario as a whole |
| App | e2e (Playwright) | a real or staging backend | 3–10 critical paths (sign-in, the main scenario, payment) |

The pyramid: most tests are for pure functions and stores (fast, stable),
fewer integration tests, very few e2e.

---

## 3. Infrastructure

### 3.1. Setup

```ts
// vitest.setup.ts
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "@/shared/lib/test/msw-server";

beforeAll(() => server.listen({ onUnhandledFrame: "error" })); // MSW 3; in MSW 2 — onUnhandledRequest
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
```

`onUnhandledFrame: "error"` — any unmocked request fails the test instead of
hitting the network. The option name depends on the MSW version, and MSW
silently ignores unknown options: verify that an unmocked request actually fails.

### 3.2. Test providers

One function that assembles the app's **global** providers with test
implementations. The test adds slice providers (with fake deps) itself — that
way it's visible what exactly is replaced.

```tsx
// shared/lib/test/render.tsx
type TestServices = {
  confirm?: (params: ConfirmParams) => Promise<boolean>;
  toast?: ToastApi;
};

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

export function renderWithProviders(ui: ReactElement, services: TestServices = {}) {
  const queryClient = createTestQueryClient();
  const toast = services.toast ?? createFakeToast();
  const confirm = services.confirm ?? vi.fn(async () => true);

  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en">
        <ConfirmProvider value={confirm}>
          <ToastProvider value={toast}>{ui}</ToastProvider>
        </ConfirmProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );

  return { ...result, queryClient, toast, confirm, user: userEvent.setup() };
}
```

Copy in tests uses the real translations of the default locale: queries like
`getByRole("button", { name: "Remove card" })` read like a scenario.

---

## 4. Fakes and data builders: `testing.ts`

Every slice with a contract has a second, test-only public API:

```ts
// features/task-board/testing.ts — imported ONLY from tests
import { vi } from "vitest";
import type { TaskBoardDeps } from "./model/deps";
import type { Board, BoardCard, BoardColumn } from "./model/board";

export function createFakeTaskBoardDeps(overrides: Partial<TaskBoardDeps> = {}): TaskBoardDeps {
  return {
    createCard: vi.fn<TaskBoardDeps["createCard"]>(async ({ title }) => buildCard({ title })),
    editCard: vi.fn<TaskBoardDeps["editCard"]>(async () => null),
    deleteCard: vi.fn<TaskBoardDeps["deleteCard"]>(async () => {}),
    saveBoard: vi.fn<TaskBoardDeps["saveBoard"]>(async () => {}),
    ...overrides,
  };
}

let sequence = 0;
export const buildCard = (overrides: Partial<BoardCard> = {}): BoardCard => ({
  id: `card-${++sequence}`,
  title: "Card",
  ...overrides,
});
export const buildColumn = (overrides: Partial<BoardColumn> = {}): BoardColumn => ({
  id: `column-${++sequence}`,
  title: "Column",
  cards: [],
  ...overrides,
});
export const buildBoard = (overrides: Partial<Board> = {}): Board => ({
  id: `board-${++sequence}`,
  columns: [],
  ...overrides,
});
```

- The default fake is the "happy path"; a test overrides only what matters to it.
- Builders produce a valid object with sensible values; the test specifies only
  the meaningful fields. This makes the test resilient to new fields.
- Entities export model and DTO builders (`buildTask`, `buildTaskDto`) and MSW
  handlers (`taskHandlers`) from their `testing.ts`.
- Importing `testing.ts` from production code is forbidden by the linter
  (see `conventions.md`, "Boundaries linter" section).

---

## 5. Pure functions

```ts
// features/task-board/model/board.test.ts
describe("moveCard", () => {
  const setup = () =>
    buildBoard({
      columns: [
        buildColumn({ id: "todo", cards: [buildCard({ id: "a" }), buildCard({ id: "b" })] }),
        buildColumn({ id: "done" }),
      ],
    });
  const cardIds = (board: Board, columnId: string) =>
    board.columns.find((column) => column.id === columnId)?.cards.map((card) => card.id);

  it("moves a card to another column at the given index", () => {
    const next = moveCard(setup(), "a", { columnId: "done", index: 0 });

    expect(cardIds(next, "todo")).toEqual(["b"]);
    expect(cardIds(next, "done")).toEqual(["a"]);
  });

  it("does not mutate the original board", () => {
    const board = setup();
    const snapshot = structuredClone(board);

    moveCard(board, "a", { columnId: "done", index: 0 });

    expect(board).toEqual(snapshot);
  });

  it("throws for an unknown card", () => {
    expect(() => moveCard(setup(), "missing", { columnId: "done", index: 0 })).toThrow(/missing/);
  });
});
```

Cover edge cases: empty lists, moving within the same column, an out-of-range
index, duplicates.

---

## 6. Stores and services with dependencies

```ts
// features/task-board/model/board-store.test.ts
function setup(overrides: Partial<TaskBoardDeps> = {}) {
  const deps = createFakeTaskBoardDeps(overrides);
  const board = buildBoard({
    columns: [
      buildColumn({ id: "todo", cards: [buildCard({ id: "a", title: "Write tests" })] }),
      buildColumn({ id: "done" }),
    ],
  });
  const store = createBoardStore(board, () => deps);
  return { store, deps, board };
}

it("saves the board after moving a card", async () => {
  const { store, deps } = setup();

  await store.getState().moveCard("a", { columnId: "done", index: 0 });

  expect(deps.saveBoard).toHaveBeenCalledWith(store.getState().board);
});

it("rolls back the board when saving fails", async () => {
  const { store, board } = setup({
    saveBoard: vi.fn(async () => { throw new Error("network down"); }),
  });

  await expect(store.getState().moveCard("a", { columnId: "done", index: 0 })).rejects.toThrow("network down");

  expect(store.getState().board).toEqual(board);
});

it("keeps the card unchanged when the user cancels editing", async () => {
  const { store, board } = setup({ editCard: vi.fn(async () => null) });

  await store.getState().editCard("a");

  expect(store.getState().board).toEqual(board);
});
```

What to check: what was called in deps and with what; the resulting state;
rollback on error; behavior on cancellation (`null`); that the error is
rethrown, not swallowed.

---

## 7. Slice components and hooks

```tsx
// features/task-board/ui/task-board.test.tsx
function renderBoard(options: { deps?: Partial<TaskBoardDeps>; confirm?: () => Promise<boolean> } = {}) {
  const deps = createFakeTaskBoardDeps(options.deps);
  const board = buildBoard({
    columns: [buildColumn({ id: "todo", cards: [buildCard({ id: "a", title: "Write tests" })] })],
  });
  const view = renderWithProviders(
    <TaskBoardProvider initialBoard={board} deps={deps}>
      <TaskBoard />
    </TaskBoardProvider>,
    { confirm: options.confirm },
  );
  return { ...view, deps };
}

it("removes a card after confirmation", async () => {
  const { user, deps } = renderBoard({ confirm: async () => true });

  await user.click(screen.getByRole("button", { name: "Remove card Write tests" }));

  expect(deps.deleteCard).toHaveBeenCalledWith("a");
  expect(screen.queryByText("Write tests")).not.toBeInTheDocument();
});

it("keeps the card when the user declines", async () => {
  const { user, deps } = renderBoard({ confirm: async () => false });

  await user.click(screen.getByRole("button", { name: "Remove card Write tests" }));

  expect(deps.deleteCard).not.toHaveBeenCalled();
  expect(screen.getByText("Write tests")).toBeInTheDocument();
});

it("shows an error and restores the card when deletion fails", async () => {
  const { user, toast } = renderBoard({
    deps: { deleteCard: vi.fn(async () => { throw new Error("500"); }) },
  });

  await user.click(screen.getByRole("button", { name: "Remove card Write tests" }));

  expect(toast.error).toHaveBeenCalled();
  expect(await screen.findByText("Write tests")).toBeInTheDocument();
});
```

- Queries by role and accessible name (`getByRole`, `getByLabelText`);
  `getByTestId` is the last resort. If an element can't be found by role, it's
  often an accessibility problem in the component itself.
- Actions via `userEvent`, not `fireEvent`.
- Waiting for an async result — `findBy*` / `waitFor`, not `sleep`.
- Hooks without UI — `renderHook` with a `wrapper` from the test providers.

---

## 8. Server data

```ts
// entities/task/api/task.queries.test.ts
it("maps the task DTO to the domain model", async () => {
  server.use(
    http.get("/api/tasks/:id", () =>
      HttpResponse.json(buildTaskDto({ id: "1", title: "A", assignee_id: null })),
    ),
  );

  const { result } = renderHook(() => useQuery(taskQueries.detail("1")), {
    wrapper: createQueryWrapper(),
  });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toMatchObject({ id: "1", title: "A", assigneeId: undefined });
});

it("exposes the error when the server fails", async () => {
  server.use(http.get("/api/tasks/:id", () => new HttpResponse(null, { status: 500 })));
  // ... expect isError
});
```

- Default MSW handlers ("happy path") live in the entity's `testing.ts`; a test
  overrides what it needs via `server.use`.
- Check mutations by their effect: after `createTask`, the list subscribed to
  `taskQueries.list` is refetched (the handler is called again / the data
  updated in the UI).

---

## 9. Page and adapters

- **An adapter** (`use-<feature>-adapter.ts`) is tested with `renderHook`:
  call `result.current.createCard(...)` and check the type mapping and what
  went to the API (via MSW) or to the fakes of lower hooks.
- **A page** — one or two integration tests of the key scenario with MSW:
  loaded → the user performed the main action → sees the result. Don't
  duplicate checks already done at the slice level.

---

## 10. What not to do

- `vi.mock` of your own modules instead of DI.
- Checking a store's internal state from a component test.
- Snapshots of large trees: they break on any markup change and check nothing.
  Acceptable for small serializable values.
- Testing libraries (that `useQuery` caches, that `zustand` updates).
- Tests that depend on run order, real time, the network, the machine's locale.
- `sleep`/`setTimeout` in tests instead of `findBy*` / fake timers.
- Trivial tests for coverage's sake (a component renders a prop as text).
- Swallowing errors in tests: if the code should throw — `rejects.toThrow`.
- Relying on CSS in jsdom: it doesn't apply styles, and an element hidden by a
  class (`hidden`, a Tailwind variant) still exists for Testing Library and is
  found by name. Make name queries precise (`/^password$/i`, not
  `/password/i`, which also matches "Show password"); check CSS-dependent
  visibility in e2e.

---

## 11. Checklist

- [ ] Non-trivial pure logic is covered by unit tests with edge cases.
- [ ] The store/service is tested with fake deps: success, error with rollback,
      cancellation.
- [ ] The slice's key user scenarios are covered by component tests.
- [ ] No `vi.mock` of your own modules, no real network, no real time.
- [ ] Contracts have fakes and models have builders, in `testing.ts`.
- [ ] The tests have been run, and they pass.
