# Состояние и данные

Примеры — на TanStack Query v5 и Zustand. Если в проекте другие
библиотеки (RTK Query, SWR, Redux, MobX, Pinia), переноси принципы, а не API.

## Содержание

1. Классификация состояния
2. Серверные данные: клиент, DTO, фабрики запросов
3. Мутации и инвалидация
4. Оптимистичные обновления
5. Состояния загрузки в UI
6. Клиентские сторы
7. Конкурентность и согласованность
8. Формы
9. Состояние в URL
10. Чек-лист

---

## 1. Классификация состояния

Перед тем как завести состояние, ответь на вопросы по порядку:

1. **Это можно вычислить из другого состояния?** → не храни, вычисляй.
2. **Источник истины — сервер?** → кэш запросов, не копируй в стор.
3. **Должно переживать перезагрузку / делиться ссылкой?** → URL.
4. **Это поля ввода до отправки?** → библиотека форм.
5. **Нужно одному компоненту?** → `useState` / `useReducer`.
6. **Нужно поддереву (экрану, виджету)?** → стор-фабрика + context,
   экземпляр на провайдер.
7. **Нужно всему приложению и это не сервер/URL?** (тема, язык, состояние
   сайдбара) → стор в `app` или `entities`, инициализируется в `app`.

Самая частая ошибка — пункт 2: данные сервера копируются в клиентский стор
и дальше вручную синхронизируются (`set({ tasks: await api.getTasks() })`
после каждой мутации). Кэш запросов делает это лучше.

---

## 2. Серверные данные

### 2.1. Где что лежит

```text
shared/api/            http-клиент (один экземпляр), сгенерированный клиент
                       (OpenAPI/orval), общие типы ошибок, интерсепторы-порты
entities/task/api/     task.dto.ts      — DTO и маппинг DTO ⇄ модель
                       task.queries.ts  — фабрика ключей и queryOptions
                       task.mutations.ts — переиспользуемые CRUD-мутации
entities/task/model/   task.ts          — доменный тип Task и правила
features/<x>/api/      запросы, нужные только этому сценарию
```

Если сущность используется одним экраном — всё это живёт в `pages/<page>/api`.

**Контракт транспорта (интерфейс над API-клиентом).** Интерфейс вида
`AuthApi` с фабрикой реализаций оправдан, только если у него уже есть
второй потребитель: разные транспорты (через BFF и напрямую, GraphQL и
REST), разные бэкенды по окружению или фейк, который нельзя заменить
перехватом сети (MSW). Иначе — функции запросов поверх одного клиента, а в
тестах сеть подменяет MSW. Значение конфига без реализации (`type: "mock"`,
которое бросает «not implemented») не заводится.

### 2.2. DTO не протекают в UI

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

Изменение формата бэкенда затрагивает один маппер, а не весь UI. Для
данных из недоверенных источников (внешние API, localStorage, URL) —
runtime-валидация на границе (`zod` и аналоги).

### 2.3. Фабрика запросов

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

// использование
const { data } = useQuery(taskQueries.detail(taskId));
```

- Ключи иерархические: инвалидация `taskQueries.all()` задевает всё о задачах.
- `signal` пробрасывается в http-клиент — уход со страницы отменяет запрос.
- Ключи не пишутся строками по месту — только через фабрику.

---

## 3. Мутации и инвалидация

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

- **Где мутация.** Простой CRUD, нужный нескольким сценариям, — в
  `entities/<x>/api`. Мутация как часть пользовательского сценария
  (подтверждение, несколько запросов, тост, переход) — в `features/<x>/model`,
  поверх CRUD сущности.
- **Мутация возвращает результат** (созданную/обновлённую модель), чтобы
  вызывающий код не делал лишний запрос и мог продолжить сценарий.
- **Инвалидация описана рядом с мутацией**, а не размазана по UI.
- Хук мутации отдаёт `mutateAsync` (для `await` и контрактов `deps`) и, если
  нужно UI, `isPending` — для блокировки повторной отправки.

---

## 4. Оптимистичные обновления

Правило: **оптимистичное обновление без отката — баг.** Сеть упадёт, и UI
будет показывать то, чего нет на сервере.

### 4.1. В кэше запросов

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

### 4.2. В клиентском сторе

Паттерн `commit(next, persist)`: запомнить предыдущее, применить новое,
при ошибке вернуть и **пробросить ошибку** (показ ошибки — забота UI). Код —
`dependency-injection.md`, раздел 5.2.

**Когда откат опасен.** Если между применением и ошибкой пришли другие
изменения, «вернуть предыдущее» затрёт их. Для сложных случаев вместо
отката перезагружай актуальное состояние с сервера (инвалидация / `reload`).

---

## 5. Состояния загрузки в UI

Каждый асинхронный UI явно обрабатывает **четыре** состояния:
loading, error, empty, success.

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

- Собственные асинхронные состояния описывай discriminated union:
  `{ status: "idle" } | { status: "pending" } | { status: "error"; error: AppError } | { status: "success"; data: T }`,
  а не набором `isLoading` + `error` + `data`, допускающим невозможные
  комбинации.
- Кнопка, запускающая мутацию, блокируется на время `isPending`.
- Альтернатива — Suspense + error boundary, если проект их использует
  последовательно. Не смешивай оба подхода на одном экране.

---

## 6. Клиентские сторы

### 6.1. Нужен ли стор вообще

Стор оправдан для **сложного интерактивного локального состояния**:
редактор с drag&drop, многошаговый мастер, канвас, корзина до оформления.
Для «загрузить и показать» стор не нужен — хватает кэша запросов.

### 6.2. Правила

- **Фабрика + провайдер, экземпляр на поддерево.** Никаких
  `export const useStore = create(...)` на уровне модуля для данных,
  зависящих от пользователя или экрана: такие синглтоны протекают между
  тестами, между пользователями при SSR и между экранами.
- **Зависимости — аргументом фабрики** (`getDeps`), см. DI-reference.
- **Минимальная форма состояния.** Не храни производное (`filteredCards`,
  `count`, `usersById` рядом с `users`). Нормализуй, если одна сущность
  встречается в нескольких местах.
- **Действия — оркестрация, вычисления — чистые функции.** Тело действия:
  взять состояние → вызвать доменную функцию → `set` → вызвать deps.
- **Новый экземпляр при смене сущности** — `key` на провайдере.

### 6.3. Селекторы

```ts
// Хорошо: атомарные селекторы, стабильные ссылки
const title = useBoardStore((state) => state.board.title);
const addCard = useBoardStore((state) => state.addCard);

// Плохо: новый объект на каждый вызов → лишние ререндеры
// (в Zustand v5 — бесконечный цикл)
const { title, addCard } = useBoardStore((state) => ({ title: state.board.title, addCard: state.addCard }));
// Если нужен объект — useShallow:
const { title, addCard } = useBoardStore(useShallow((state) => ({ title: state.board.title, addCard: state.addCard })));

// Плохо: вычисление внутри селектора строит новую структуру каждый раз
const usersById = useUsersStore((state) => state.users.reduce(/* ... */, {}));
// Хорошо: выбрать исходные данные, вычислить мемоизированно
const users = useUsersStore((state) => state.users);
const usersById = useMemo(() => indexById(users), [users]);
```

### 6.4. Копия серверных данных в сторе

Если стор держит редактируемую копию серверных данных (доска для drag&drop),
явно определи:
- **начальный снимок** — из запроса, при монтировании провайдера;
- **сохранение** — через deps (`saveBoard`), с инвалидацией кэша;
- **внешние изменения** (другой пользователь, realtime) — действие
  `reset(board)` или пересоздание провайдера по `key`/версии.

---

## 7. Конкурентность и согласованность

- **Гранулярные команды лучше сохранения агрегата целиком.**
  `moveCard(cardId, to)` на сервере вместо `PUT /boards/:id` со всей доской:
  целиком — «последняя запись выигрывает» и затирает чужие правки.
  Если бэкенд умеет только целиком — зафиксируй это как известное
  ограничение и сообщи пользователю.
- **Устаревшие ответы игнорируются.** Кэш запросов делает это сам; в
  самописных эффектах используй `AbortController` и флаг отмены.
- **Повторная отправка блокируется** (`isPending`), а мутации над одной
  сущностью при необходимости сериализуются (`scope` в TanStack Query или
  очередь в сторе).
- **Один запрос на много ожидающих (single-flight)** — refresh токена,
  загрузка конфига: все ожидающие получают **результат** общего промиса, а не
  просто дожидаются его завершения; промис сбрасывается в `finally`;
  исходный запрос повторяется не больше одного раза.

  ```ts
  let refreshing: Promise<boolean> | null = null;

  async function refreshOnce(refresh: () => Promise<boolean>) {
    refreshing ??= refresh().finally(() => { refreshing = null; });
    return refreshing; // ✗ `await refreshing;` без результата: ждущие повторят запрос и после неудачи
  }
  ```
- **Идентификаторы для оптимистичных сущностей** генерируются через
  внедряемую `createId`, а не на сервере постфактум, если UI нужен id сразу.

---

## 8. Формы

- Библиотека форм (`react-hook-form` и т. п.) + схема валидации; схема —
  рядом с формой в `model/`.
- Форма монтируется **после** загрузки начальных данных (или
  пересоздаётся по `key`), иначе `defaultValues` останутся пустыми.
- Ошибки сервера сопоставляются полям (`setError`) или показываются над
  формой; форма не закрывается при ошибке.
- Отправка блокируется на время `isSubmitting`.
- Компонент формы не решает, что делать после успеха: `onSuccess(result)`
  наверх (DI, ступень 1).

---

## 9. Состояние в URL

Фильтры, сортировка, пагинация, выбранная вкладка, открытая сущность —
в search params, если ими нужно делиться ссылкой или они должны пережить
перезагрузку.

- Чтение/запись — в хуке страницы (`pages/<page>/model/use-<page>-filters.ts`),
  с разбором и валидацией (некорректный параметр → значение по умолчанию).
- Фичи получают значения пропсами и сообщают изменения колбэками — они не
  знают, что состояние живёт в URL.

---

## 10. Чек-лист

- [ ] Состояние классифицировано; серверные данные не скопированы в стор без
      причины; производное не хранится.
- [ ] DTO маппятся на границе API; ключи запросов — из фабрики.
- [ ] Мутации возвращают результат и инвалидируют связанные запросы.
- [ ] Оптимистичные обновления откатываются или перезапрашивают данные.
- [ ] UI обрабатывает loading / error / empty / success; кнопки блокируются
      во время отправки.
- [ ] Сторы — фабрики с зависимостями аргументом; провайдер с `key`;
      селекторы возвращают стабильные ссылки.
