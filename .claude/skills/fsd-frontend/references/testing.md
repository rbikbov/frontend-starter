# Тестирование

Примеры — Vitest, Testing Library, user-event, MSW, TanStack Query. Для Jest
и других раннеров принципы те же.

## Содержание

1. Принципы
2. Что тестировать на каждом уровне
3. Инфраструктура: setup, тестовые провайдеры, MSW
4. Фейки и билдеры данных: `testing.ts`
5. Чистые функции
6. Сторы и сервисы с зависимостями
7. Компоненты и хуки слайса
8. Серверные данные
9. Страница и адаптеры
10. Чего не делать
11. Чек-лист

---

## 1. Принципы

- **Тест проверяет поведение через публичный интерфейс**: вход функции →
  выход; действие пользователя → то, что он видит, и вызванные зависимости.
  Не внутреннее состояние и не приватные функции.
- **Зависимости подменяются через DI**, а не через `vi.mock` своих модулей.
  Если код невозможно протестировать без `vi.mock("@/shared/api")` —
  это сигнал, что зависимость скрыта; исправь код (DI-reference, раздел 5).
  `vi.mock` допустим для сторонних модулей, которые нельзя внедрить.
- **Детерминизм.** Время, id, random — внедряются или фиксируются
  (`vi.useFakeTimers()`, `createId` в deps). Реальной сети нет никогда.
- **Один тест — одно поведение.** Имя теста описывает поведение:
  `"rolls back the board when saving fails"`, а не `"test moveCard 2"`.
- **Arrange / Act / Assert**, общий arrange — в функции `setup()`, а не в
  `beforeEach` с мутируемыми переменными.
- Тест лежит рядом с файлом: `board.ts` → `board.test.ts`.

---

## 2. Что тестировать на каждом уровне

| Уровень | Тип теста | Подмена зависимостей | Что проверять |
|---|---|---|---|
| `model/<domain>.ts` (чистые функции) | unit | не нужна | правила, граничные случаи, неизменяемость входа |
| Фабрика стора / сервиса | unit | фейковые `deps` | порядок вызовов deps, итоговое состояние, откат при ошибке, отмена |
| Хук / компонент слайса | Testing Library | провайдер слайса с фейковыми deps + тестовые сервисы | сценарий пользователя: клик → что видно, что вызвано |
| Хуки серверных данных | Testing Library | MSW + свежий QueryClient | маппинг DTO, обработка ошибки, инвалидация |
| Адаптер страницы | unit / renderHook | фейки нижних хуков или MSW | маппинг типов, правильное связывание |
| Страница | интеграционный | MSW | ключевой сценарий экрана целиком |
| Приложение | e2e (Playwright) | реальный или стенд-бэкенд | 3–10 критических путей (вход, основной сценарий, оплата) |

Пирамида: больше всего — чистых функций и сторов (быстро, стабильно),
меньше — интеграционных, совсем немного — e2e.

---

## 3. Инфраструктура

### 3.1. Setup

```ts
// vitest.setup.ts
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "@/shared/lib/test/msw-server";

beforeAll(() => server.listen({ onUnhandledFrame: "error" })); // MSW 3; в MSW 2 — onUnhandledRequest
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
```

`onUnhandledFrame: "error"` — любой незамоканный запрос валит тест,
а не уходит в сеть. Имя опции зависит от версии MSW, а неизвестную опцию MSW
тихо игнорирует: проверь, что незамоканный запрос действительно падает.

### 3.2. Тестовые провайдеры

Одна функция, которая собирает **глобальные** провайдеры приложения с
тестовыми реализациями. Провайдеры слайсов (с фейковыми deps) тест
добавляет сам — так видно, что именно подменено.

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

Тексты в тестах — реальные переводы локали по умолчанию: запросы
`getByRole("button", { name: "Remove card" })` читаются как сценарий.

---

## 4. Фейки и билдеры данных: `testing.ts`

У каждого слайса с контрактом — второй, тестовый public API:

```ts
// features/task-board/testing.ts — импортируется ТОЛЬКО из тестов
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

- Фейк по умолчанию — «счастливый путь»; тест переопределяет только то, что
  ему важно.
- Билдеры дают валидный объект с разумными значениями; тест указывает
  только значимые поля. Это делает тест устойчивым к добавлению новых полей.
- Сущности экспортируют билдеры моделей и DTO (`buildTask`, `buildTaskDto`)
  и MSW-хендлеры (`taskHandlers`) из своего `testing.ts`.
- Импорт `testing.ts` из прод-кода запрещён линтером
  (см. `conventions.md`, раздел «Линтер границ»).

---

## 5. Чистые функции

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

Покрывай граничные случаи: пустые списки, перемещение в ту же колонку,
индекс за пределами, дубликаты.

---

## 6. Сторы и сервисы с зависимостями

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

Что проверять: что вызвано в deps и с чем; итоговое состояние; откат при
ошибке; поведение при отмене (`null`); что ошибка проброшена, а не
проглочена.

---

## 7. Компоненты и хуки слайса

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

- Запросы — по роли и доступному имени (`getByRole`, `getByLabelText`);
  `getByTestId` — последний вариант. Если элемент нельзя найти по роли, это
  часто проблема доступности самого компонента.
- Действия — через `userEvent`, не `fireEvent`.
- Ожидание асинхронного результата — `findBy*` / `waitFor`, не `sleep`.
- Хуки без UI — `renderHook` с `wrapper` из тестовых провайдеров.

---

## 8. Серверные данные

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
  // ... ожидаем isError
});
```

- MSW-хендлеры по умолчанию («счастливый путь») — в `testing.ts`
  сущности; тест переопределяет нужное через `server.use`.
- Мутации проверяй по эффекту: после `createTask` список, подписанный на
  `taskQueries.list`, перезапрашивается (хендлер вызван повторно / данные
  обновились в UI).

---

## 9. Страница и адаптеры

- **Адаптер** (`use-<feature>-adapter.ts`) тестируется `renderHook`:
  вызови `result.current.createCard(...)` и проверь маппинг типов и то,
  что ушло в API (через MSW) или в фейки нижних хуков.
- **Страница** — один-два интеграционных теста ключевого сценария с MSW:
  загрузилась → пользователь сделал главное действие → видит результат.
  Не дублируй здесь проверки, уже сделанные на уровне слайсов.

---

## 10. Чего не делать

- `vi.mock` собственных модулей вместо DI.
- Проверять внутреннее состояние стора из теста компонента.
- Снапшоты больших деревьев: ломаются от любой правки разметки и ничего
  не проверяют. Допустимы для маленьких сериализуемых значений.
- Тестировать библиотеки (что `useQuery` кэширует, что `zustand` обновляет).
- Тесты, зависящие от порядка запуска, реального времени, сети, локали машины.
- `sleep`/`setTimeout` в тестах вместо `findBy*` / fake timers.
- Тривиальные тесты ради покрытия (компонент рендерит пропс как текст).
- Глотать ошибки в тестах: если код должен бросить — `rejects.toThrow`.
- Полагаться на CSS в jsdom: он не применяет стили, и элемент, скрытый
  классом (`hidden`, вариант Tailwind), для Testing Library существует и
  находится по имени. Запросы по имени делай точными (`/^password$/i`, а не
  `/password/i`, который совпадёт и с «Show password»); видимость, зависящую
  от CSS, проверяй в e2e.

---

## 11. Чек-лист

- [ ] Нетривиальная чистая логика покрыта unit-тестами с граничными случаями.
- [ ] Стор/сервис протестирован с фейковыми deps: успех, ошибка с откатом,
      отмена.
- [ ] Ключевые сценарии пользователя слайса покрыты компонентными тестами.
- [ ] Нет `vi.mock` собственных модулей, реальной сети, реального времени.
- [ ] Для контрактов есть фейки, для моделей — билдеры, в `testing.ts`.
- [ ] Тесты запущены, и они проходят.
