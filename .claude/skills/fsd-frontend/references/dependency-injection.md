# Инверсия зависимостей (IoC / DI) во фронтенде на FSD

Самый важный навык в этой архитектуре. Правило «импорт только вниз, без
cross-import» без него невыполнимо, а тестируемость без него стоит дорого
(моки модулей, тяжёлые провайдеры, сеть в unit-тестах).

**Суть в одной фразе:** модуль объявляет, *что* ему нужно (контракт), а
*кто* это даст, решает тот, кто модуль использует (слой выше).

## Содержание

1. Сквозной пример
2. Ступень 1 — пропсы, аргументы, колбэки
3. Ступень 2 — композиция: children и render props
4. Ступень 3 — контракт `deps` + strict context
5. Ступень 4 — фабрика стора/сервиса с зависимостями
6. Сборка на странице: адаптер
7. Глобальные сервисы: confirm, toast, navigate, i18n, время, id
8. Promise-диалоги
9. «Изменилось там — обнови здесь»: связь между слайсами во времени
10. Ловушки
11. Чек-лист

---

## 1. Сквозной пример

Домен — трекер задач. Нужен экран доски (kanban): колонки, карточки,
перетаскивание, создание карточки, редактирование в диалоге.

```text
shared/lib/react     createStrictContext, useLatest
shared/lib/dialogs   DialogsHost, useDialogs, useConfirm  (реализация в app)
shared/lib/toast     useToast                              (реализация в app)
entities/task        Task, taskQueries, useCreateTask, useDeleteTask
entities/board       Board(DTO→модель), boardQueries, useSaveBoard, isBoardMember
features/edit-task   диалог редактирования задачи
features/task-board  kanban: колонки, карточки, drag&drop
pages/board          экран: собирает всё вместе
```

Проблема: `features/task-board` должна создавать задачи (`entities/task` —
можно импортировать, это ниже) и открывать диалог из `features/edit-task`
(тот же слой — **нельзя**). Кроме того, фича доски полезна сама по себе: её
можно переиспользовать для доски, где карточки — не задачи, а, например,
кандидаты в найме. Поэтому она не должна знать про `Task` вовсе.

---

## 2. Ступень 1 — пропсы, аргументы, колбэки

Самая простая и самая частая форма DI. Начинай всегда с неё.

```tsx
// features/sign-in/ui/sign-in-form.tsx
// Фича не знает про роутер (он в app) и не решает, куда вести после входа.
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

Функции — то же самое: правило передаётся аргументом, а не импортируется.

```ts
// features/edit-task/model/assignee.ts
export function getAssigneeOptions(
  users: User[],
  canAssignUser: (userId: string) => boolean,
): User[] {
  return users.filter((user) => canAssignUser(user.id));
}
```

**Используй, когда** зависимость нужна на 1–2 уровня вниз. Проброс через
3+ компонента, которым она не нужна (prop drilling), — сигнал перейти на
ступень 2 или 3.

---

## 3. Ступень 2 — композиция: children и render props

Когда модулю нужно **показать** чужой UI внутри себя, он оставляет «дырку»,
а страница её заполняет.

```tsx
// features/task-board/ui/task-board.tsx
type TaskBoardProps = {
  /** Дополнительные действия на карточке — их даёт тот, кто собирает экран. */
  renderCardActions?: (card: BoardCard) => ReactNode;
};

// pages/board/ui/board-page.tsx
<TaskBoard
  renderCardActions={(card) => <StartTimerButton taskId={card.id} />}
/>
```

Варианты той же идеи: `children`, именованные слоты-пропсы
(`header`, `footer`, `emptyState`), compound components
(`<Dialog.Title/>`). Модуль `task-board` ничего не знает про `track-time`.

---

## 4. Ступень 3 — контракт `deps` + strict context

Когда зависимость нужна глубоко в дереве или нескольким компонентам/хукам
слайса, пропсы превращаются в шум. Тогда слайс объявляет **контракт** и
получает реализацию через контекст.

### 4.1. Утилита strict context (shared)

```ts
// shared/lib/react/strict-context.ts
import { createContext, useContext, type Provider } from "react";

/**
 * Контекст без значения по умолчанию. Если провайдера нет — ошибка сразу,
 * а не тихий undefined где-то в глубине.
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

### 4.2. Контракт объявляет потребитель

```ts
// features/edit-task/model/deps.ts
import { createStrictContext } from "@/shared/lib/react";

/** Что фиче редактирования задачи нужно от внешнего мира. */
export type EditTaskDeps = {
  /** Можно ли назначить пользователя исполнителем. Правило — снаружи. */
  canAssignUser: (userId: string) => boolean;
};

export const [EditTaskDepsProvider, useEditTaskDeps] =
  createStrictContext<EditTaskDeps>("EditTaskDeps");
```

```tsx
// features/edit-task/ui/assignee-field.tsx — компонент глубоко внутри формы
export function AssigneeField({ control }: { control: Control<TaskFormValues> }) {
  const { canAssignUser } = useEditTaskDeps();
  const users = useUsers();
  const options = getAssigneeOptions(users, canAssignUser);
  // ...
}
```

Фича не знает, что правило назначения на этом экране — «участник доски».
На другом экране правило может быть другим — фича не изменится.

### 4.3. Правила контракта

- **Термины потребителя.** `task-board` говорит `BoardCard`, а не `Task`.
- **Минимальность.** Только то, что вызывается. `canAssignUser`, а не
  «весь объект доски» и не «весь стор пользователей».
- **Функции, а не объекты-сервисы.** `createCard(input)` проще подменить и
  адаптировать, чем `cardService` с десятью методами.
- **Отмена — значение, ошибка — исключение.** `editCard` возвращает
  `BoardCard | null`; `null` — пользователь закрыл диалог.
- **Документируй семантику** JSDoc-комментарием, если она не очевидна из
  типа (кто отвечает за подтверждение, что значит `null`, идемпотентность).
- **Провайдер — часть public API** слайса (экспортируется из `index.ts`),
  хук-потребитель — внутренний.

---

## 5. Ступень 4 — фабрика стора/сервиса с зависимостями

Нереактивная логика (стор, use-case, сервис) получает зависимости
**аргументом фабрики**, а не импортом. Это делает её тестируемой обычным
unit-тестом — без React, без сети, без `vi.mock`.

### 5.1. Чистое ядро

```ts
// features/task-board/model/board.ts — только данные на вход и выход
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

/** Перемещает карточку по id (не по индексу — список может быть отфильтрован). */
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

// replaceCard, removeCard, findCard — аналогично
```

### 5.2. Контракт фичи и фабрика

```ts
// features/task-board/model/deps.ts
export type TaskBoardDeps = {
  createCard: (input: { title: string }) => Promise<BoardCard>;
  /** Открывает редактор карточки. null — пользователь отменил. */
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
 * getDeps, а не deps: стор живёт дольше одного рендера, а реализации
 * зависимостей (замыкания на свежие данные) могут меняться. См. раздел 10.
 */
export function createBoardStore(initial: Board, getDeps: () => TaskBoardDeps) {
  return createStore<BoardState>()((set, get) => {
    /** Оптимистично применяет изменение; при ошибке откатывает и пробрасывает. */
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

Обрати внимание, чего в сторе **нет**:
- импорта `api`, роутера, toast, confirm, i18n;
- текстов для пользователя;
- решения «спросить подтверждение» и «как показать ошибку» — это UX,
  он принадлежит хуку/компоненту (5.4).

### 5.3. Провайдер: экземпляр на поддерево

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

/** Используй с key={board.id}: другой board — другой экземпляр стора. */
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

Здесь `deps` приходят **пропсом** провайдера (ступень 1), а не отдельным
контекстом: компонентам внутри фичи deps напрямую не нужны, им нужен стор.
Отдельный deps-контекст (ступень 3) заводи, только когда хукам/компонентам
нужны зависимости, не проходящие через стор.

### 5.4. UX-решения — в хуке слайса

```ts
// features/task-board/model/use-remove-card.ts
export function useRemoveCard() {
  const removeCard = useBoardStore((state) => state.removeCard);
  const confirm = useConfirm();   // shared/lib/dialogs — импорт вниз, DI не нужен
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

Подтверждение — ровно в одном месте. Стор при этом остаётся чистым и
тестируется без диалогов.

---

## 6. Сборка на странице: адаптер

Страница — единственное место, которое видит и `task-board`, и
`edit-task`, и сущности. Связывание оформляется **хуком-адаптером** в
`model/` страницы: так JSX страницы остаётся читаемым, а адаптер можно
протестировать отдельно.

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

Что здесь важно:
- маппинг `Task → BoardCard` и `Board(entity) → Board(feature)` живёт в
  адаптере, фичи друг о друге не знают;
- бизнес-правило «назначать можно только участников доски» взято из
  сущности (`isBoardMember`) — оно описано один раз;
- `key={boardId}` гарантирует новый экземпляр стора при смене доски.

---

## 7. Глобальные сервисы: confirm, toast, navigate, i18n, время, id

Сервисы, нужные всему приложению, устроены как **порт в `shared` +
реализация в `app`**:

```text
shared/lib/toast/      тип ToastApi, ToastProvider (strict context), useToast
app/providers/         <ToastProvider value={implementation}> + отрисовка тостов
```

- Слайсы импортируют `useToast()` из `shared` напрямую — это импорт вниз.
- Реализацию подключает `app`; в тестах — тестовый провайдер с фейком.
- Нереактивной логике (сторы, сервисы) эти сервисы **не нужны**: UX-решения
  принимаются в хуках (5.4). Если всё же нужны — передай функцией в deps.

**Время, id, random** — тоже зависимости. Если логика зависит от «сейчас»
или генерирует id, а результат проверяется в тесте, передавай
`now: () => Date` / `createId: () => string` в фабрику или функцию, а не
вызывай `Date.now()` / `nanoid()` внутри.

**Навигация** — не зависимость фич вовсе: фича сообщает о результате
(колбэк `onSuccess`, возвращаемый Promise), а куда переходить — решает
страница.

---

## 8. Promise-диалоги

Диалог как асинхронная функция: `const task = await openEditTask(id)`.
Это превращает «открыть модалку, дождаться результата, продолжить» в
линейный код и отлично сочетается с контрактами `deps`.

```tsx
// shared/lib/dialogs/dialogs.tsx
type Resolve<R> = (result: R) => void;
type DialogsApi = { open: <R>(render: (resolve: Resolve<R>) => ReactNode) => Promise<R> };

const [DialogsContext, useDialogs] = createStrictContext<DialogsApi>("Dialogs");
export { useDialogs };

let nextDialogId = 0;

/** Монтируется один раз в app. */
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
        // Диалог рендерится в DialogsHost (в app), а не там, где его открыли:
        // контексты страницы ему НЕ видны. Поэтому deps передаются явно.
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

`useConfirm()` строится поверх `useDialogs()` так же и возвращает
`Promise<boolean>`.

---

## 9. «Изменилось там — обнови здесь»

Слайсам часто нужно реагировать на изменения в других слайсах. Варианты в
порядке предпочтения:

1. **Общий кэш серверных данных.** Мутация инвалидирует ключи запросов
   (`taskQueries.all()`), все подписчики обновятся сами. Слайсы не знают
   друг о друге. Покрывает большинство случаев.
2. **Колбэк / возвращаемое значение.** `onSaved(task)`, `await editCard()` —
   инициатор узнаёт результат и сам обновляет то, чем владеет.
3. **Колбэк в контракте `deps`.** `onBoardChanged?: () => void` — страница
   решает, кого уведомить.
4. **Шина событий / realtime.** Только для действительно глобальных или
   внешних событий (websocket «доску изменил другой пользователь»).
   Транспорт — в `shared/api`; подписка — в хуке слайса, который владеет
   реакцией; имена и payload событий типизированы.

Не используй глобальную шину для связи двух компонентов одного экрана:
связь становится неявной, порядок обработки — непредсказуемым.

---

## 10. Ловушки

**Устаревшие зависимости в долгоживущем сторе.** Стор создаётся один раз
(`useState(() => create...)`), а адаптер на каждом рендере возвращает новые
функции, замкнутые на свежие данные. Если передать фабрике `deps` объектом,
стор навсегда запомнит первый вариант. Решение — `getDeps` + `useLatest`
(5.3).

**Нестабильные deps в контексте → лишние ререндеры.** Если deps кладутся в
контекст (ступень 3), а не в ref, мемоизируй объект (`useMemo`) или держи
функции стабильными (`useCallback`), иначе каждый рендер страницы
перерисует всех потребителей.

**Контекст, невидимый из портала-хоста.** Всё, что рендерится в глобальном
хосте (диалоги, тосты), видит только провайдеры `app`. Передавай нужное
явно (раздел 8).

**Смена сущности без смены стора.** Переход с `/board/1` на `/board/2`
переиспользует компонент и стор со старыми данными. Используй `key`.

**Порядок провайдеров.** Провайдер, использующий контекст, должен быть
внутри провайдера этого контекста. Strict context покажет ошибку сразу —
не глуши её дефолтным значением.

**Контракт в терминах поставщика.** `deps.updateTask(task: Task)` внутри
`task-board` — та же связанность, что и cross-import, только скрытая.

**Божественный контракт.** 15 функций в deps — признак, что слайс делает
слишком много или что часть зависимостей на самом деле — импорт вниз.

**DI ради DI.** Контекст для значения, которое нужно одному дочернему
компоненту, — лишняя косвенность. Пропс.

**Скрытый синглтон.** `import { api } from "@/shared/api"` внутри фабрики
стора делает зависимость невидимой и требует `vi.mock`. Внутри React-хуков
импорт запросов из `entities`/`shared` нормален (тестируется через MSW), а в
фабриках и чистых функциях — нет.

**Повторение побочного эффекта.** Если и хук, и стор показывают confirm —
пользователь увидит два диалога. У каждого эффекта ровно один владелец.

---

## 11. Чек-лист

- [ ] Выбрана самая нижняя достаточная ступень (пропс → композиция →
      контекст → фабрика).
- [ ] Контракт объявлен потребителем, в его терминах, минимален,
      задокументирован там, где семантика неочевидна.
- [ ] Связывание и маппинг типов — в адаптере страницы (или `app`).
- [ ] Нереактивная логика получает зависимости аргументом (`getDeps`), а
      не импортом; в ней нет UX-решений и текстов.
- [ ] Для контракта есть фейк в `testing.ts`.
- [ ] Провайдеры строгие; долгоживущие экземпляры пересоздаются по `key`.
- [ ] У каждого побочного эффекта ровно один владелец.
