# Anti-patterns

A catalog for reviews. Each item: what it looks like, why it's bad, how to do
it right. If you meet one in existing code, don't copy it; report it.

## Architecture and dependencies

### 1. Cross-import between slices of the same layer

```ts
// ✗ features/task-board/ui/card.tsx
import { useEditTaskDialog } from "@/features/edit-task";
```

The features are coupled: you can't change or test one without the other, and
the risk of cycles grows. **Right:** an `editCard` contract in the board
feature's `deps`, wired in the page (DI reference, sections 5–6). If two
features always change together, merge them into one.

### 2. Hidden dependency in non-reactive logic

```ts
// ✗
import { api } from "@/shared/api";
export const createBoardStore = (board: Board) =>
  createStore<BoardState>()((set) => ({
    save: async () => { await api.updateBoard(board.id, board); },
  }));
```

The signature doesn't show that the store needs the network; the test requires
`vi.mock`. **Right:** `createBoardStore(board, getDeps)` and `getDeps().saveBoard(board)`.

### 3. Half-injected dependencies

Some dependencies come through `deps`, others are imported directly in the
same store. You get the worst of both worlds: indirection and a hidden
coupling. **Right:** all of the factory's external logic goes through one contract.

### 4. Contract in the provider's terms

```ts
// ✗ features/task-board/model/deps.ts
import type { Task } from "@/entities/task";
type TaskBoardDeps = { updateTask: (task: Task) => Promise<Task> };
```

The board feature now knows about tasks and can't be reused for other cards.
**Right:** `editCard(cardId) => Promise<BoardCard | null>`; the `Task → BoardCard`
mapping lives in the page's adapter.

### 5. Hidden or scattered contract

```ts
// ✗ deps.ts doesn't declare a contract but reuses the store's type
import type { BoardCardStore } from "./board.store";
export const boardDepsContext = createStrictContext<BoardCardStore>();
// ✗ while the store factory takes three more dependencies as separate arguments
```

To understand what the slice needs from outside, you have to read the store
and the provider. **Right:** one explicit contract in the consumer slice's
`model/deps.ts` with JSDoc; the store, provider, fake and adapter refer to that type.

### 6. Premature extraction and "slices for the future"

`entities/comment` with a single consumer; `features/x` with empty `api/`,
`lib/`, `config/`; a widget that just puts two features side by side.
**Right:** the code lives in the page until a second real consumer appears;
segments appear as needed; composition lives in `pages`.

### 7. God slice

`features/board` does drag and drop, access control, task editing, search and
export. **Right:** a slice per scenario: `move-card`, `manage-board-access`,
`edit-task`, `search-board`.

### 8. DI for DI's sake

Context + provider + fake for a value needed by one child component.
**Right:** a prop. Context is for when the dependency is needed deep down or by
many.

## Logic and state

### 9. One side effect, two owners

```ts
// ✗ the hook asks for confirmation and calls store.removeColumn,
//   which also asks for confirmation
```

The user sees two dialogs; behavior depends on which path was used.
**Right:** an effect has one owner — UX decisions in the hook, the store is pure.

### 10. Copy and UX inside the store

```ts
// ✗
removeColumn: async (id) => {
  if (!(await getConfirmation({ title: "Delete column" }))) return;
  // ...
}
```

The store can't be reused without the dialog, and the copy bypasses i18n.
**Right:** a `useRemoveColumn` hook — confirm + translation + error handling;
the store only changes and saves.

### 11. Server data manually copied into a store

```ts
// ✗ after every mutation
set({ tasks: await api.getTasks() });
```

Extra requests, races, manual sync, no loading/error.
**Right:** a query cache + invalidation (state-and-data.md, section 3).

### 12. Optimistic update without rollback

```ts
// ✗
set({ board: next });
await api.updateBoard(next); // failed — the UI lies
```

**Right:** `commit(next, persist)` with rollback and rethrowing the error, or a
refetch from the server.

### 13. Saving the whole aggregate

`PUT /boards/:id` with the whole board after every drag — two users' edits
overwrite each other. **Right:** granular commands (`moveCard`); if the
backend can't do that, record the limitation.

### 14. Selector builds a new structure

```ts
// ✗ a new object on every call, O(n) per list row
const assignee = useUsers((state) => state.usersMap()[card.assigneeId]);
```

**Right:** select the source data and compute with memoization; or a selector
that returns a specific element: `state.users.find(...)`; for lists, the index
is computed once higher up the tree.

### 15. Index of a filtered list as a coordinate

```tsx
// ✗ the list is filtered by search, but the index is passed to moveCard as a position in the original column
{cards.filter(matches).map((card, index) => <Draggable index={index} … />)}
onDragEnd={(e) => moveCard({ colId, index: e.source.index }, …)}
```

With an active filter, the wrong card moves. **Right:** address by id
(`moveCard(cardId, target)`) and translate the target position from the
filtered view to the original; or disable dragging while a filter is active.

### 16. A hook that isn't a hook

```ts
// ✗
export function useCanUserAccessBoard() {
  return (userId: string, board: Board) => board.ownerId === userId || …;
}
```

A pure function can't be called outside a component, and the rule looks
React-specific. **Right:** `isBoardMember(board, userId)` in the entity's model.

### 17. One rule in several places

"Board member = owner or editor" is described in the page's ability, in the
board list's ability and in a feature hook. Changing the rule means three edits
and a bug in a fourth place. **Right:** one function in `entities/board/model/access.ts`.

## Errors and async

### 18. Swallowing errors

```ts
// ✗
api.setTheme({ theme }).catch();          // catches nothing
try { ... } catch { return {}; }          // a failure looks like "no data"
promise.finally(stop).catch(() => {});    // silently
if (!session) throw new Error();          // no message
```

**Right:** handle meaningfully (rollback + message to the user + report) or
rethrow; errors must have messages.

### 19. Unsafe error parsing

```ts
// ✗ throws a TypeError on a network error — there is no response
if (error.response.status === 401) …
```

**Right:** normalize into `AppError` at the API boundary, then use `kind`.

### 20. Interceptors and subscriptions without cleanup

Registering in `useEffect` without `eject`/`off` → on remount (StrictMode,
HMR) handlers are duplicated. **Right:** keep the id and remove it in cleanup.

## Code

### 21. Side effects on module import

```ts
// ✗ shared/api/client.ts
window.api = api;
```

**Right:** imports without effects; debug helpers via explicit initialization
in `app`, dev only.

### 22. Hardcoded environment and copy

```ts
// ✗
io("ws://localhost:3334");
<h2>All boards</h2>
```

**Right:** `env.wsUrl` from `shared/config`; `t("boards.title")`.

### 23. Typos and imprecise names in the API

`Ablity`, `createModuleAblility`, `useApplayAppInterceptor`,
`removeTask(userId)` (the parameter is a task id). **Right:** names are
checked like code; a parameter is named for what it holds.

### 24. Dead code and "just in case"

Unused hooks, empty `index.ts`, extra state fields not described in the type,
config values that throw "not implemented" when chosen. **Right:** delete.
Git keeps the history.

### 25. Junk in markup

```tsx
// ✗ the extra ";" renders as text
<form onSubmit={submit}>{children}</form>;
```

Component tests on visible text and careful review of JSX inside parentheses
catch such mistakes.
