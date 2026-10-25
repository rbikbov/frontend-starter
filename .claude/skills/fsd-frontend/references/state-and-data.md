# State and data

Examples use TanStack Query v5 and Zustand. If the project uses other
libraries (RTK Query, SWR, Redux, MobX, Pinia), carry over the principles, not
the API.

## Contents

1. Classifying state
2. Server data: client, DTOs, query factories
3. Mutations and invalidation
4. Optimistic updates
5. Loading states in the UI
6. Client stores
7. Concurrency and consistency
8. Forms
9. State in the URL
10. Checklist

---

## 1. Classifying state

Before introducing state, answer these questions in order:

1. **Can it be computed from other state?** → don't store it, compute it.
2. **Is the source of truth the server?** → query cache, don't copy into a store.
3. **Must it survive a reload / be shareable by link?** → URL.
4. **Is it input fields before submission?** → a form library.
5. **Needed by one component?** → `useState` / `useReducer`.
6. **Needed by a subtree (screen, widget)?** → store factory + context, an
   instance per provider.
7. **Needed by the whole app and not server/URL?** (theme, language, sidebar
   state) → a store in `app` or `entities`, initialized in `app`.

The most common mistake is item 2: server data is copied into a client store
and then synced manually (`set({ tasks: await api.getTasks() })` after every
mutation). A query cache does this better.

---

## 2. Server data

### 2.1. What goes where

```text
shared/api/            http client (one instance), generated client
                       (OpenAPI/orval), shared error types, interceptor ports
entities/task/api/     task.dto.ts      — DTO and DTO ⇄ model mapping
                       task.queries.ts  — key factory and queryOptions
                       task.mutations.ts — reusable CRUD mutations
entities/task/model/   task.ts          — the Task domain type and rules
features/<x>/api/      queries needed only by this scenario
```

If the entity is used by a single screen, all of this lives in `pages/<page>/api`.

**Transport contract (an interface over the API client).** An interface like
`AuthApi` with a factory of implementations is justified only if it already
has a second consumer: different transports (via the BFF and directly,
GraphQL and REST), different backends per environment, or a fake that can't be
replaced by network interception (MSW). Otherwise — query functions over a
single client, and MSW replaces the network in tests. Don't add a config value
without an implementation (`type: "mock"` that throws "not implemented").

### 2.2. DTOs don't leak into the UI

```ts
// entities/task/api/task.dto.ts
import type { TaskDto } from "@/shared/api";
import type { Task } from "../model/task";

export function mapTask(dto: TaskDto): Task {
  return {
    id: dto.id,
    title: dto.title,
    description: dto.description ?? "",
    assigneeId: dto.assignee_id ?? undefined,
    createdAt: new Date(dto.created_at),
  };
}
```

A backend format change touches one mapper, not the whole UI. For data from
untrusted sources (external APIs, localStorage, URL) — runtime validation at
the boundary (`zod` and similar).

### 2.3. Query factory

```ts
// entities/task/api/task.queries.ts
import { queryOptions } from "@tanstack/react-query";

export const taskQueries = {
  all: () => ["tasks"] as const,
  lists: () => [...taskQueries.all(), "list"] as const,
  list: (filters: TaskFilters) =>
    queryOptions({
      queryKey: [...taskQueries.lists(), filters],
      queryFn: ({ signal }) => getTasks(filters, { signal }).then((dtos) => dtos.map(mapTask)),
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...taskQueries.all(), "detail", id],
      queryFn: ({ signal }) => getTask(id, { signal }).then(mapTask),
    }),
};

// usage
const { data } = useQuery(taskQueries.detail(taskId));
```

- Keys are hierarchical: invalidating `taskQueries.all()` covers everything about tasks.
- `signal` is forwarded to the http client — leaving the page aborts the request.
- Keys are never written as inline strings — only through the factory.

---

## 3. Mutations and invalidation

```ts
// entities/task/api/task.mutations.ts
export function useCreateTask() {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(toCreateTaskDto(input)).then(mapTask),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskQueries.lists() }),
  });
  return mutateAsync;
}
```

- **Where the mutation lives.** Simple CRUD needed by several scenarios — in
  `entities/<x>/api`. A mutation that is part of a user scenario
  (confirmation, several requests, a toast, navigation) — in
  `features/<x>/model`, on top of the entity's CRUD.
- **A mutation returns the result** (the created/updated model), so the calling
  code doesn't make an extra request and can continue the scenario.
- **Invalidation is described next to the mutation**, not scattered across the UI.
- The mutation hook exposes `mutateAsync` (for `await` and `deps` contracts)
  and, if the UI needs it, `isPending` — to block resubmission.

---

## 4. Optimistic updates

Rule: **an optimistic update without rollback is a bug.** The network will
fail, and the UI will show something that isn't on the server.

### 4.1. In the query cache

```ts
export function useRenameTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => updateTask(id, { title }),
    onMutate: async ({ id, title }) => {
      const { queryKey } = taskQueries.detail(id);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (task) => (task ? { ...task, title } : task));
      return { previous };
    },
    onError: (_error, { id }, context) => {
      queryClient.setQueryData(taskQueries.detail(id).queryKey, context?.previous);
    },
    onSettled: (_data, _error, { id }) =>
      queryClient.invalidateQueries({ queryKey: taskQueries.detail(id).queryKey }),
  });
}
```

### 4.2. In a client store

The `commit(next, persist)` pattern: remember the previous state, apply the new
one, on error restore it and **rethrow** (showing the error is the UI's job).
Code — `dependency-injection.md`, section 5.2.

**When rollback is dangerous.** If other changes arrived between applying and
the error, "restore the previous state" overwrites them. For complex cases,
instead of rolling back, reload the actual state from the server
(invalidation / `reload`).

---

## 5. Loading states in the UI

Every async UI explicitly handles **four** states: loading, error, empty,
success.

```tsx
export function TaskList({ filters }: { filters: TaskFilters }) {
  const { t } = useI18n();
  const tasksQuery = useQuery(taskQueries.list(filters));

  if (tasksQuery.isPending) return <TaskListSkeleton />;
  if (tasksQuery.isError) {
    return <ErrorState message={t("tasks.load-failed")} onRetry={() => tasksQuery.refetch()} />;
  }
  if (tasksQuery.data.length === 0) return <EmptyState message={t("tasks.empty")} />;

  return (
    <ul>
      {tasksQuery.data.map((task) => <TaskRow key={task.id} task={task} />)}
    </ul>
  );
}
```

- Describe your own async states with a discriminated union:
  `{ status: "idle" } | { status: "pending" } | { status: "error"; error: AppError } | { status: "success"; data: T }`,
  not a set of `isLoading` + `error` + `data` that allows impossible
  combinations.
- A button that triggers a mutation is disabled while `isPending`.
- The alternative is Suspense + error boundaries, if the project uses them
  consistently. Don't mix both approaches on one screen.

---

## 6. Client stores

### 6.1. Do you need a store at all

A store is justified for **complex interactive local state**: an editor with
drag&drop, a multi-step wizard, a canvas, a cart before checkout. For "load and
show" you don't need a store — the query cache is enough.

### 6.2. Rules

- **Factory + provider, an instance per subtree.** No module-level
  `export const useStore = create(...)` for user- or screen-dependent data:
  such singletons leak between tests, between users during SSR and between
  screens.
- **Dependencies as a factory argument** (`getDeps`), see the DI reference.
- **Minimal state shape.** Don't store derived data (`filteredCards`, `count`,
  `usersById` next to `users`). Normalize if one entity appears in several places.
- **Actions orchestrate, pure functions compute.** An action body: take the
  state → call a domain function → `set` → call deps.
- **A new instance when the entity changes** — `key` on the provider.

### 6.3. Selectors

```ts
// Good: atomic selectors, stable references
const title = useBoardStore((state) => state.board.title);
const addCard = useBoardStore((state) => state.addCard);

// Bad: a new object on every call → extra re-renders
// (in Zustand v5 — an infinite loop)
const { title, addCard } = useBoardStore((state) => ({ title: state.board.title, addCard: state.addCard }));
// If you need an object — useShallow:
const { title, addCard } = useBoardStore(useShallow((state) => ({ title: state.board.title, addCard: state.addCard })));

// Bad: computing inside the selector builds a new structure every time
const usersById = useUsersStore((state) => state.users.reduce(/* ... */, {}));
// Good: select the source data, compute with memoization
const users = useUsersStore((state) => state.users);
const usersById = useMemo(() => indexById(users), [users]);
```

### 6.4. A copy of server data in a store

If a store holds an editable copy of server data (a board for drag&drop),
define explicitly:
- **the initial snapshot** — from the query, when the provider mounts;
- **saving** — via deps (`saveBoard`), with cache invalidation;
- **external changes** (another user, realtime) — a `reset(board)` action or
  recreating the provider by `key`/version.

---

## 7. Concurrency and consistency

- **Granular commands beat saving the whole aggregate.**
  `moveCard(cardId, to)` on the server instead of `PUT /boards/:id` with the
  whole board: the whole thing means "last write wins" and overwrites others'
  edits. If the backend can only save the whole thing, record it as a known
  limitation and tell the user.
- **Stale responses are ignored.** A query cache does this itself; in
  hand-written effects use an `AbortController` and a cancellation flag.
- **Resubmission is blocked** (`isPending`), and mutations on the same entity
  are serialized when needed (`scope` in TanStack Query or a queue in the store).
- **One request for many waiters (single-flight)** — token refresh, config
  loading: all waiters get the **result** of the shared promise, not just wait
  for it to finish; the promise is reset in `finally`; the original request is
  retried at most once.

  ```ts
  let refreshing: Promise<boolean> | null = null;

  async function refreshOnce(refresh: () => Promise<boolean>) {
    refreshing ??= refresh().finally(() => { refreshing = null; });
    return refreshing; // ✗ `await refreshing;` without the result: waiters would retry even after a failure
  }
  ```
- **Ids for optimistic entities** are generated via an injected `createId`,
  not by the server after the fact, if the UI needs the id right away.

---

## 8. Forms

- A form library (`react-hook-form` etc.) + a validation schema; the schema
  lives next to the form in `model/`.
- The form mounts **after** the initial data loads (or is recreated by `key`),
  otherwise `defaultValues` stay empty.
- Server errors are mapped to fields (`setError`) or shown above the form; the
  form doesn't close on error.
- Submission is blocked while `isSubmitting`.
- The form component doesn't decide what to do after success: `onSuccess(result)`
  goes up (DI, rung 1).

---

## 9. State in the URL

Filters, sorting, pagination, the selected tab, the open entity — in search
params, if they need to be shareable by link or survive a reload.

- Reading/writing — in the page's hook (`pages/<page>/model/use-<page>-filters.ts`),
  with parsing and validation (an invalid parameter → the default value).
- Features receive values via props and report changes via callbacks — they
  don't know the state lives in the URL.

---

## 10. Checklist

- [ ] State is classified; server data isn't copied into a store without a
      reason; derived data isn't stored.
- [ ] DTOs are mapped at the API boundary; query keys come from the factory.
- [ ] Mutations return the result and invalidate related queries.
- [ ] Optimistic updates roll back or refetch the data.
- [ ] The UI handles loading / error / empty / success; buttons are disabled
      during submission.
- [ ] Stores are factories with dependencies as an argument; the provider has
      a `key`; selectors return stable references.
