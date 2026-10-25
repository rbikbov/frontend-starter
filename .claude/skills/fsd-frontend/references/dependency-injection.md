# Dependency inversion (IoC / DI) in an FSD frontend

The most important skill in this architecture. Without it, the "import only
downwards, no cross-imports" rule is impossible to follow, and testability is
expensive (module mocks, heavy providers, network in unit tests).

**The gist in one sentence:** a module declares *what* it needs (a contract),
and whoever uses the module (the layer above) decides *who* provides it.

## Contents

1. A running example
2. Rung 1 — props, arguments, callbacks
3. Rung 2 — composition: children and render props
4. Rung 3 — a `deps` contract + strict context
5. Rung 4 — a store/service factory with dependencies
6. Wiring on the page: the adapter
7. Global services: confirm, toast, navigate, i18n, time, id
8. Promise dialogs
9. "Changed there — update here": connecting slices over time
10. Pitfalls
11. Checklist

---

## 1. A running example

The domain is a task tracker. We need a board (kanban) screen: columns, cards,
drag and drop, creating a card, editing in a dialog.

```text
shared/lib/react     createStrictContext, useLatest
shared/lib/dialogs   DialogsHost, useDialogs, useConfirm  (implemented in app)
shared/lib/toast     useToast                              (implemented in app)
entities/task        Task, taskQueries, useCreateTask, useDeleteTask
entities/board       Board(DTO→model), boardQueries, useSaveBoard, isBoardMember
features/edit-task   task editing dialog
features/task-board  kanban: columns, cards, drag&drop
pages/board          the screen: puts everything together
```

The problem: `features/task-board` must create tasks (`entities/task` — may be
imported, it's below) and open a dialog from `features/edit-task` (the same
layer — **not allowed**). Besides, the board feature is useful on its own: it
can be reused for a board where cards aren't tasks but, say, hiring candidates.
So it shouldn't know about `Task` at all.

---

## 2. Rung 1 — props, arguments, callbacks

The simplest and most common form of DI. Always start here.

```tsx
// features/sign-in/ui/sign-in-form.tsx
// The feature doesn't know about the router (it's in app) and doesn't decide where to go after sign-in.
type SignInFormProps = { onSuccess: (session: Session) => void };

export function SignInForm({ onSuccess }: SignInFormProps) {
  const signIn = useSignIn();
  // ...
  const handleSubmit = form.handleSubmit(async (values) => {
    const session = await signIn(values);
    onSuccess(session);
  });
  // ...
}

// pages/sign-in/ui/sign-in-page.tsx
export function SignInPage() {
  const navigate = useNavigate();
  return <SignInForm onSuccess={() => navigate(routes.boards())} />;
}
```

Same for functions: a rule is passed as an argument, not imported.

```ts
// features/edit-task/model/assignee.ts
export function getAssigneeOptions(
  users: User[],
  canAssignUser: (userId: string) => boolean,
): User[] {
  return users.filter((user) => canAssignUser(user.id));
}
```

**Use when** the dependency is needed 1–2 levels down. Passing it through 3+
components that don't need it (prop drilling) is a signal to move to rung 2 or 3.

---

## 3. Rung 2 — composition: children and render props

When a module needs to **show** someone else's UI inside itself, it leaves a
"hole", and the page fills it.

```tsx
// features/task-board/ui/task-board.tsx
type TaskBoardProps = {
  /** Extra actions on a card — provided by whoever assembles the screen. */
  renderCardActions?: (card: BoardCard) => ReactNode;
};

// pages/board/ui/board-page.tsx
<TaskBoard
  renderCardActions={(card) => <StartTimerButton taskId={card.id} />}
/>
```

Variants of the same idea: `children`, named slot props (`header`, `footer`,
`emptyState`), compound components (`<Dialog.Title/>`). The `task-board`
module knows nothing about `track-time`.

---

## 4. Rung 3 — a `deps` contract + strict context

When a dependency is needed deep in the tree or by several components/hooks of
the slice, props become noise. Then the slice declares a **contract** and gets
the implementation through context.

### 4.1. Strict context utility (shared)

```ts
// shared/lib/react/strict-context.ts
import { createContext, useContext, type Provider } from "react";

/**
 * A context without a default value. If the provider is missing — an error
 * right away, not a silent undefined somewhere deep down.
 */
export function createStrictContext<T>(name: string) {
  const Context = createContext<T | null>(null);
  Context.displayName = name;

  function useStrictContext(): T {
    const value = useContext(Context);
    if (value === null) {
      throw new Error(`${name}: provider is missing in the component tree`);
    }
    return value;
  }

  return [Context.Provider as Provider<T>, useStrictContext] as const;
}
```

### 4.2. The consumer declares the contract

```ts
// features/edit-task/model/deps.ts
import { createStrictContext } from "@/shared/lib/react";

/** What the task editing feature needs from the outside world. */
export type EditTaskDeps = {
  /** Whether the user can be made the assignee. The rule comes from outside. */
  canAssignUser: (userId: string) => boolean;
};

export const [EditTaskDepsProvider, useEditTaskDeps] =
  createStrictContext<EditTaskDeps>("EditTaskDeps");
```

```tsx
// features/edit-task/ui/assignee-field.tsx — a component deep inside the form
export function AssigneeField({ control }: { control: Control<TaskFormValues> }) {
  const { canAssignUser } = useEditTaskDeps();
  const users = useUsers();
  const options = getAssigneeOptions(users, canAssignUser);
  // ...
}
```

The feature doesn't know that on this screen the assignment rule is "board
member". On another screen the rule may differ — the feature won't change.

### 4.3. Contract rules

- **The consumer's terms.** `task-board` says `BoardCard`, not `Task`.
- **Minimal.** Only what is called. `canAssignUser`, not "the whole board
  object" or "the whole users store".
- **Functions, not service objects.** `createCard(input)` is easier to replace
  and adapt than a `cardService` with ten methods.
- **Cancellation is a value, an error is an exception.** `editCard` returns
  `BoardCard | null`; `null` means the user closed the dialog.
- **Document the semantics** with a JSDoc comment if they aren't obvious from
  the type (who handles confirmation, what `null` means, idempotency).
- **The provider is part of the slice's public API** (exported from
  `index.ts`); the consumer hook is internal.

---

## 5. Rung 4 — a store/service factory with dependencies

Non-reactive logic (a store, use case, service) receives dependencies **as a
factory argument**, not via import. That makes it testable with a plain unit
test — no React, no network, no `vi.mock`.

### 5.1. Pure core

```ts
// features/task-board/model/board.ts — only data in and out
export type BoardCard = { id: string; title: string; assigneeId?: string };
export type BoardColumn = { id: string; title: string; cards: BoardCard[] };
export type Board = { id: string; columns: BoardColumn[] };
export type CardTarget = { columnId: string; index: number };

export function addCard(board: Board, columnId: string, card: BoardCard): Board {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId
        ? { ...column, cards: [...column.cards, card] }
        : column,
    ),
  };
}

/** Moves a card by id (not by index — the list may be filtered). */
export function moveCard(board: Board, cardId: string, to: CardTarget): Board {
  const card = findCard(board, cardId);
  if (!card) throw new Error(`moveCard: card "${cardId}" not found`);

  const withoutCard = removeCard(board, cardId);
  return {
    ...withoutCard,
    columns: withoutCard.columns.map((column) => {
      if (column.id !== to.columnId) return column;
      const cards = [...column.cards];
      cards.splice(to.index, 0, card);
      return { ...column, cards };
    }),
  };
}

// replaceCard, removeCard, findCard — similarly
```

### 5.2. The feature's contract and factory

```ts
// features/task-board/model/deps.ts
export type TaskBoardDeps = {
  createCard: (input: { title: string }) => Promise<BoardCard>;
  /** Opens the card editor. null — the user cancelled. */
  editCard: (cardId: string) => Promise<BoardCard | null>;
  deleteCard: (cardId: string) => Promise<void>;
  saveBoard: (board: Board) => Promise<void>;
};
```

```ts
// features/task-board/model/board-store.ts
import { createStore } from "zustand/vanilla";
import { addCard, moveCard, removeCard, replaceCard, type Board, type CardTarget } from "./board";
import type { TaskBoardDeps } from "./deps";

export type BoardState = {
  board: Board;
  addCard: (columnId: string, title: string) => Promise<void>;
  editCard: (cardId: string) => Promise<void>;
  removeCard: (cardId: string) => Promise<void>;
  moveCard: (cardId: string, to: CardTarget) => Promise<void>;
};

export type BoardStore = ReturnType<typeof createBoardStore>;

/**
 * getDeps, not deps: the store outlives a single render, and the dependency
 * implementations (closures over fresh data) may change. See section 10.
 */
export function createBoardStore(initial: Board, getDeps: () => TaskBoardDeps) {
  return createStore<BoardState>()((set, get) => {
    /** Applies a change optimistically; on error rolls back and rethrows. */
    async function commit(next: Board, persist: () => Promise<void>) {
      const previous = get().board;
      set({ board: next });
      try {
        await persist();
      } catch (error) {
        set({ board: previous });
        throw error;
      }
    }

    return {
      board: initial,

      addCard: async (columnId, title) => {
        const card = await getDeps().createCard({ title });
        const next = addCard(get().board, columnId, card);
        await commit(next, () => getDeps().saveBoard(next));
      },

      editCard: async (cardId) => {
        const updated = await getDeps().editCard(cardId);
        if (!updated) return;
        set({ board: replaceCard(get().board, updated) });
      },

      removeCard: async (cardId) => {
        const next = removeCard(get().board, cardId);
        await commit(next, () => getDeps().deleteCard(cardId));
      },

      moveCard: async (cardId, to) => {
        const next = moveCard(get().board, cardId, to);
        await commit(next, () => getDeps().saveBoard(next));
      },
    };
  });
}
```

Note what the store **doesn't** have:
- imports of `api`, the router, toast, confirm, i18n;
- user-facing copy;
- the decisions "ask for confirmation" and "how to show the error" — that's
  UX, and it belongs to the hook/component (5.4).

### 5.3. Provider: an instance per subtree

```tsx
// shared/lib/react/use-latest.ts
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
```

```tsx
// features/task-board/model/task-board-provider.tsx
import { useStore } from "zustand";

const [BoardStoreContext, useBoardStoreApi] =
  createStrictContext<BoardStore>("TaskBoardStore");

type TaskBoardProviderProps = {
  initialBoard: Board;
  deps: TaskBoardDeps;
  children: ReactNode;
};

/** Use with key={board.id}: a different board — a different store instance. */
export function TaskBoardProvider({ initialBoard, deps, children }: TaskBoardProviderProps) {
  const depsRef = useLatest(deps);
  const [store] = useState(() =>
    createBoardStore(initialBoard, () => depsRef.current),
  );
  return <BoardStoreContext value={store}>{children}</BoardStoreContext>;
}

export function useBoardStore<T>(selector: (state: BoardState) => T): T {
  return useStore(useBoardStoreApi(), selector);
}
```

Here `deps` come in as a provider **prop** (rung 1), not as a separate
context: components inside the feature don't need deps directly, they need
the store. Add a separate deps context (rung 3) only when hooks/components
need dependencies that don't go through the store.

### 5.4. UX decisions live in the slice's hook

```ts
// features/task-board/model/use-remove-card.ts
export function useRemoveCard() {
  const removeCard = useBoardStore((state) => state.removeCard);
  const confirm = useConfirm();   // shared/lib/dialogs — a downward import, no DI needed
  const toast = useToast();       // shared/lib/toast
  const { t } = useI18n();

  return useCallback(async (card: BoardCard) => {
    const confirmed = await confirm({
      title: t("remove-card.title"),
      description: t("remove-card.description", { title: card.title }),
    });
    if (!confirmed) return;

    try {
      await removeCard(card.id);
    } catch (error) {
      toast.error(t("remove-card.failed"));
      reportError(error);
    }
  }, [confirm, removeCard, t, toast]);
}
```

Confirmation happens in exactly one place. The store stays pure and is tested
without dialogs.

---

## 6. Wiring on the page: the adapter

The page is the only place that sees `task-board`, `edit-task` and the
entities. Wiring is done in an **adapter hook** in the page's `model/`: that
keeps the page's JSX readable, and the adapter can be tested separately.

```ts
// pages/board/model/use-task-board-adapter.ts
import type { TaskBoardDeps, BoardCard } from "@/features/task-board";
import { useEditTaskDialog } from "@/features/edit-task";
import { useCreateTask, useDeleteTask, type Task } from "@/entities/task";
import { isBoardMember, useSaveBoard, type Board } from "@/entities/board";

const toBoardCard = (task: Task): BoardCard => ({
  id: task.id,
  title: task.title,
  assigneeId: task.assigneeId,
});

export function useTaskBoardAdapter(board: Board): TaskBoardDeps {
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const saveBoard = useSaveBoard();
  const openEditTask = useEditTaskDialog();

  return {
    createCard: async ({ title }) =>
      toBoardCard(await createTask({ title, boardId: board.id })),

    editCard: async (cardId) => {
      const task = await openEditTask(cardId, {
        canAssignUser: (userId) => isBoardMember(board, userId),
      });
      return task ? toBoardCard(task) : null;
    },

    deleteCard: (cardId) => deleteTask(cardId),
    saveBoard: (next) => saveBoard(toBoardDto(next)),
  };
}
```

```tsx
// pages/board/ui/board-page.tsx
export function BoardPage({ boardId }: { boardId: string }) {
  const boardQuery = useQuery(boardQueries.detail(boardId));

  if (boardQuery.isPending) return <PageSpinner />;
  if (boardQuery.isError) return <PageError error={boardQuery.error} onRetry={boardQuery.refetch} />;

  return <BoardScreen key={boardId} board={boardQuery.data} />;
}

function BoardScreen({ board }: { board: Board }) {
  const deps = useTaskBoardAdapter(board);
  return (
    <TaskBoardProvider initialBoard={toTaskBoard(board)} deps={deps}>
      <BoardHeader board={board} />
      <TaskBoard renderCardActions={(card) => <StartTimerButton taskId={card.id} />} />
    </TaskBoardProvider>
  );
}
```

What matters here:
- the `Task → BoardCard` and `Board(entity) → Board(feature)` mappings live in
  the adapter; the features don't know about each other;
- the business rule "only board members can be assigned" comes from the
  entity (`isBoardMember`) — it's described once;
- `key={boardId}` guarantees a new store instance when the board changes.

---

## 7. Global services: confirm, toast, navigate, i18n, time, id

Services needed by the whole app are built as **a port in `shared` + an
implementation in `app`**:

```text
shared/lib/toast/      ToastApi type, ToastProvider (strict context), useToast
app/providers/         <ToastProvider value={implementation}> + rendering toasts
```

- Slices import `useToast()` from `shared` directly — it's a downward import.
- `app` plugs in the implementation; in tests — a test provider with a fake.
- Non-reactive logic (stores, services) **doesn't need** these services: UX
  decisions are made in hooks (5.4). If it does need them, pass a function in deps.

**Time, ids, random** are dependencies too. If logic depends on "now" or
generates ids, and the result is checked in a test, pass
`now: () => Date` / `createId: () => string` into the factory or function
instead of calling `Date.now()` / `nanoid()` inside.

**Navigation** is not a feature dependency at all: the feature reports the
result (an `onSuccess` callback, a returned Promise), and the page decides
where to go.

---

## 8. Promise dialogs

A dialog as an async function: `const task = await openEditTask(id)`. This
turns "open a modal, wait for the result, continue" into linear code and fits
`deps` contracts perfectly.

```tsx
// shared/lib/dialogs/dialogs.tsx
type Resolve<R> = (result: R) => void;
type DialogsApi = { open: <R>(render: (resolve: Resolve<R>) => ReactNode) => Promise<R> };

const [DialogsContext, useDialogs] = createStrictContext<DialogsApi>("Dialogs");
export { useDialogs };

let nextDialogId = 0;

/** Mounted once in app. */
export function DialogsHost({ children }: { children: ReactNode }) {
  const [dialogs, setDialogs] = useState<{ id: number; node: ReactNode }[]>([]);

  const api = useMemo<DialogsApi>(() => ({
    open: <R,>(render: (resolve: Resolve<R>) => ReactNode) =>
      new Promise<R>((resolvePromise) => {
        const id = nextDialogId++;
        const resolve: Resolve<R> = (result) => {
          setDialogs((current) => current.filter((dialog) => dialog.id !== id));
          resolvePromise(result);
        };
        setDialogs((current) => [...current, { id, node: render(resolve) }]);
      }),
  }), []);

  return (
    <DialogsContext value={api}>
      {children}
      {dialogs.map((dialog) => <Fragment key={dialog.id}>{dialog.node}</Fragment>)}
    </DialogsContext>
  );
}
```

```tsx
// features/edit-task/model/use-edit-task-dialog.tsx
export function useEditTaskDialog() {
  const { open } = useDialogs();

  return useCallback(
    (taskId: string, deps: EditTaskDeps) =>
      open<Task | null>((resolve) => (
        // The dialog is rendered in DialogsHost (in app), not where it was opened:
        // the page's contexts are NOT visible to it. So deps are passed explicitly.
        <EditTaskDepsProvider value={deps}>
          <EditTaskDialog
            taskId={taskId}
            onSaved={(task) => resolve(task)}
            onCancel={() => resolve(null)}
          />
        </EditTaskDepsProvider>
      )),
    [open],
  );
}
```

`useConfirm()` is built on top of `useDialogs()` the same way and returns a
`Promise<boolean>`.

---

## 9. "Changed there — update here"

Slices often need to react to changes in other slices. Options in order of
preference:

1. **A shared server data cache.** A mutation invalidates query keys
   (`taskQueries.all()`), and all subscribers update themselves. The slices
   don't know about each other. Covers most cases.
2. **A callback / return value.** `onSaved(task)`, `await editCard()` — the
   initiator learns the result and updates what it owns.
3. **A callback in the `deps` contract.** `onBoardChanged?: () => void` — the
   page decides whom to notify.
4. **An event bus / realtime.** Only for truly global or external events (a
   websocket "another user changed the board"). The transport lives in
   `shared/api`; the subscription — in the hook of the slice that owns the
   reaction; event names and payloads are typed.

Don't use a global bus to connect two components on the same screen: the
connection becomes implicit and the handling order unpredictable.

---

## 10. Pitfalls

**Stale dependencies in a long-lived store.** The store is created once
(`useState(() => create...)`), while the adapter returns new functions on every
render, closed over fresh data. If you pass `deps` to the factory as an object,
the store remembers the first version forever. Solution — `getDeps` + `useLatest`
(5.3).

**Unstable deps in context → extra re-renders.** If deps are put in context
(rung 3) rather than a ref, memoize the object (`useMemo`) or keep the
functions stable (`useCallback`), otherwise every page render re-renders all
consumers.

**Context invisible from a portal host.** Everything rendered in a global host
(dialogs, toasts) sees only the `app` providers. Pass what's needed explicitly
(section 8).

**Changing the entity without changing the store.** Navigating from `/board/1`
to `/board/2` reuses the component and the store with the old data. Use `key`.

**Provider order.** A provider that uses a context must be inside that
context's provider. Strict context shows the error right away — don't silence
it with a default value.

**A contract in the provider's terms.** `deps.updateTask(task: Task)` inside
`task-board` is the same coupling as a cross-import, only hidden.

**A god contract.** 15 functions in deps is a sign that the slice does too much
or that some dependencies are actually downward imports.

**DI for DI's sake.** Context for a value needed by one child component is
needless indirection. Use a prop.

**A hidden singleton.** `import { api } from "@/shared/api"` inside a store
factory makes the dependency invisible and requires `vi.mock`. Inside React
hooks, importing queries from `entities`/`shared` is fine (tested via MSW), but
not in factories and pure functions.

**A repeated side effect.** If both the hook and the store show a confirm, the
user sees two dialogs. Every effect has exactly one owner.

---

## 11. Checklist

- [ ] The lowest sufficient rung is chosen (prop → composition → context →
      factory).
- [ ] The contract is declared by the consumer, in its terms, minimal,
      documented where the semantics aren't obvious.
- [ ] Wiring and type mapping are in the page's adapter (or `app`).
- [ ] Non-reactive logic gets dependencies as an argument (`getDeps`), not via
      import; it has no UX decisions or copy.
- [ ] The contract has a fake in `testing.ts`.
- [ ] Providers are strict; long-lived instances are recreated by `key`.
- [ ] Every side effect has exactly one owner.
