# Конвенции кода

## Содержание

1. Ошибки
2. TypeScript
3. Именование
4. Public API и импорты
5. Компоненты и эффекты
6. Доступность (a11y)
7. Тексты и i18n
8. Права доступа
9. Конфигурация и побочные эффекты модулей
10. Комментарии
11. Линтер границ и полезные правила
12. Производительность

---

## 1. Ошибки

### 1.1. Модель ошибки

Все ошибки от API нормализуются **один раз**, на границе `shared/api`, в
единый тип. Остальной код не разбирает `axios`/`fetch`-ошибки.

```ts
// shared/api/app-error.ts
export type AppErrorKind =
  | "network"        // нет соединения, таймаут, CORS
  | "unauthorized"   // 401
  | "forbidden"      // 403
  | "not-found"      // 404
  | "validation"     // 400/422 с ошибками полей
  | "conflict"       // 409, устаревшая версия
  | "aborted"        // запрос отменён — не показывать пользователю
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

### 1.2. Кто за что отвечает

| Уровень | Что делает с ошибкой |
|---|---|
| Чистая функция | бросает `Error` с понятным сообщением при нарушении инварианта |
| Стор / сервис | откатывает своё состояние и **пробрасывает** |
| Хук фичи (владелец UX) | показывает пользователю (тост / inline-сообщение / ошибки полей), репортит неожиданное |
| Страница | error boundary + состояние ошибки загрузки с «Повторить» |
| `app` | глобальные 401 (выход/редирект) и 403, репорт необработанных |

### 1.3. Правила (MUST)

- Нет пустых `catch`, `.catch(() => {})`, `.catch()` без обработчика
  (последний ничего не ловит — ошибка всё равно станет unhandled rejection).
- Нет `catch`, который возвращает «пустые данные» и маскирует сбой под
  отсутствие данных.
- Пользователь видит **переведённое** сообщение по `kind`, а не
  `error.message` сервера.
- `aborted` не показывается пользователю.
- Неожиданные ошибки уходят в мониторинг через порт
  `reportError(error)` из `shared/lib/monitoring` (реализация в `app`).
- **В логи и мониторинг не попадают персональные данные и секреты:**
  email, телефон, имя, токены, пароли, тела запросов целиком. Логируй
  id сущностей, `kind` ошибки, имя операции. Это касается и
  «отладочных» логов в обработчиках форм.
- **Вид ошибки определяется по коду, а не по тексту:** HTTP-статус,
  `extensions.code` в GraphQL, поле `code` в теле ответа. Если бэкенд
  отдаёт только текст, сопоставление по тексту живёт в одном маппере в
  `shared/api`, с комментарием-причиной и тестом на каждую строку.
- Ответ с массивом ошибок проверяется целиком (`errors.some(...)`), а не
  по `errors[0]`.
- Бросается `Error`/`AppError`, а не объект-литерал (`throw { status }`):
  у литерала нет стека, и `instanceof` по нему не работает.
- `throw new Error("…")` — всегда с сообщением, при обёртке — `{ cause }`.
- Глобальные обработчики (интерсепторы) регистрируются один раз и
  снимаются при размонтировании:

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

- `strict: true`, плюс `noUncheckedIndexedAccess` (доступ по индексу/ключу
  возвращает `T | undefined` — ловит класс багов «элемент не найден»).
- Запрещены `any`, `@ts-ignore`, `as unknown as X`, non-null `!` без
  доказательства в соседней строке. `@ts-expect-error` — только с
  комментарием-причиной.
- `unknown` для данных неизвестной формы + сужение типа.
- Невозможные состояния непредставимы: discriminated unions вместо
  наборов опциональных полей.
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

- Типы выводятся из источника истины, а не дублируются:
  `ReturnType`, `z.infer`, `typeof CONST[number]`, сгенерированные DTO.
- `satisfies` для конфигов и словарей, чтобы проверить форму, сохранив
  точный тип.
- Импорт типов — `import type`.
- Публичные функции слайса имеют явные типы параметров и результата.

---

## 3. Именование

- **Имена — это API.** Опечатка в экспортируемом имени (`Ablity`,
  `useApplay…`) размножается по кодовой базе. Проверяй написание.
- Файлы и папки — `kebab-case`: `board-store.ts`, `task-card.tsx`.
- Слайсы: `entities` — существительное (`task`, `board`); `features` —
  глагол + объект (`edit-task`, `move-card`, `sign-in`); `pages` — экран
  (`board`, `settings`). Имя по сценарию, а не по месту на экране
  (`sign-out`, а не `header-menu`).
- Файлы — по предметной области (`board.ts`, `access.ts`), а не по роли
  (`utils.ts`, `helpers.ts`, `types.ts`, `constants.ts` на весь слайс).
- Компоненты — `PascalCase`; хуки — `useX` и **только** если вызывают
  другие хуки (чистая функция `canAccess(board, user)` не называется
  `useCanAccess`).
- Булевы значения — `is/has/can/should`: `isPending`, `canEdit`.
- Пропсы-события — `onX` (`onSave`), внутренние обработчики — `handleX`.
- Фабрики — `createX`, адаптеры — `useXAdapter`, фейки — `createFakeX`,
  билдеры тестовых данных — `buildX`, мапперы — `mapX` / `toX`.
- Без аббревиатур, кроме общепринятых (`id`, `url`, `dto`, `api`).

---

## 4. Public API и импорты

- `index.ts` слайса — явные именованные экспорты; `export *` не
  используется (кроме сгенерированного API-клиента в `shared/api`).
- Экспортируй минимум: то, что реально нужно потребителям. Внутренние
  хуки, сторы, подкомпоненты остаются внутри.
- Типы — `export type { … }`.
- `testing.ts` — второй public API только для тестов.
- Внутри слайса — относительные импорты; между слайсами и слоями —
  алиас `@/layer/slice`.
- В `shared` нет общего `index.ts` на весь слой: импорт по сегменту
  (`@/shared/ui/button`, `@/shared/lib/react`) — меньше циклов и лишнего кода
  в бандле.

---

## 5. Компоненты и эффекты

**Компоненты `shared/ui`:** без бизнес-логики и загрузки данных;
контролируемые (значение + `onChange`); принимают `className` и
пробрасывают `ref`/нативные атрибуты; варианты через пропсы-перечисления
(`variant="primary"`), а не через десяток булевых флагов.

**Компоненты слайса:**
- Тонкие: данные — из хуков/пропсов, логика — в `model/`. Компонент
  больше ~150 строк или с несколькими обязанностями — дели.
- Нет «умных» листьев: элемент списка получает данные пропсами, а не
  ищет их сам в глобальном сторе на каждой строке.
- Композиция вместо конфигурации: `children`/слоты вместо
  `showHeader`, `headerText`, `headerIcon`, …
- Условный рендер без ловушек: `count > 0 && …`, не `count && …`.
- **Состояние, которое DOM меняет без событий React, не дублируется в
  `useState`.** Автозаполнение браузера и `form.reset()` в
  неконтролируемой форме меняют `value` без `onChange`, и флаг
  `hasValue`, выставляемый в `onChange`, рассинхронизируется. Для
  оформления («поле заполнено», плавающий label) используй CSS:
  `:placeholder-shown`, `:autofill`, `:focus-within`, в Tailwind —
  `has-[…]`/`group-has-[…]` или свой `@custom-variant`.
- **Ключи — стабильные id**, никогда индекс, если список фильтруется,
  сортируется или перетаскивается.
- **Индекс в отфильтрованном/отсортированном представлении не является
  координатой в исходных данных.** Операции (перемещение, удаление)
  адресуй по id.

**Эффекты (`useEffect`)** — только для синхронизации с внешними
системами (подписки, DOM, сторонние виджеты, сокеты). Не для:
вычисления производного (вычисляй в рендере / `useMemo`), реакции на
событие пользователя (делай в обработчике), загрузки данных (кэш
запросов). У каждой подписки есть cleanup. Нестабильные функции внутри
эффекта — через `useEventCallback`/`useLatest`, а не через подавление
`exhaustive-deps`.

---

## 6. Доступность (a11y)

- Семантика: `button` для действий, `a` для навигации, `label` у каждого
  поля, заголовки по иерархии, таблицы — для табличных данных.
- У кнопок-иконок — `aria-label` (переведённый).
- Модалки: фокус внутрь при открытии, возврат при закрытии, `Esc`
  закрывает, фон недоступен (используй готовый примитив из `shared/ui`
  или headless-библиотеку).
- Всё, что делается мышью, делается с клавиатуры (включая drag&drop —
  либо библиотека с клавиатурной поддержкой, либо альтернативные действия).
- Ошибки полей связаны с полем (`aria-describedby`, `aria-invalid`).
- Не только цвет передаёт смысл.

Хорошая доступность упрощает тесты: элементы находятся по роли и имени.

---

## 7. Тексты и i18n

- Ни одной видимой пользователю строки вне модулей переводов — включая
  `aria-label`, `title`, `placeholder`, тексты подтверждений и тостов.
- Сторы и доменные функции текстов не содержат; если нужно сообщение —
  они возвращают код/`kind`, UI переводит.
- Переводы — рядом со слайсом (`<slice>/i18n.ts` или `ui/i18n.ts`),
  ключи с пространством имён слайса.
- Интерполяция и плюрализация средствами i18n, не конкатенацией строк.
- Даты, числа, валюты — через `Intl`/i18n-форматтеры с текущей локалью.

---

## 8. Права доступа

- **Каждое правило описано в одном месте** — чистыми функциями в модели
  сущности, которой оно принадлежит:

```ts
// entities/board/model/access.ts
export const isBoardOwner = (board: BoardAccess, userId: string) => board.ownerId === userId;
export const isBoardMember = (board: BoardAccess, userId: string) =>
  isBoardOwner(board, userId) || board.editorIds.includes(userId);
export const canManageBoardAccess = isBoardOwner;
```

  Если проект использует библиотеку прав (CASL и т. п.) — ability
  собирается в одном месте (`entities/session` или `app`), слайсы получают
  её через хук/контекст, а не определяют правила заново.
- Фича, которой нужна проверка из другого домена, получает её через
  пропс или `deps` (`canAssignUser`), а не импортирует чужую фичу.
- UI только скрывает/блокирует недоступное. Источник истины — сервер;
  ответ 403 всё равно обрабатывается.

---

## 9. Конфигурация и побочные эффекты модулей

- Переменные окружения читаются **в одном месте** (`shared/config/env.ts`),
  валидируются при старте и экспортируются типизированным объектом.
  `process.env` / `import.meta.env` в остальном коде запрещены.
- URL API, websocket, ключи сервисов, флаги — только из конфига. Секреты
  не попадают в клиентский бандл; `.env` с реальными значениями не
  коммитится (коммитится `.env.example`).
- **Импорт модуля не имеет побочных эффектов**: не пишет в `window`, не
  подписывается на события, не открывает соединения, не регистрирует
  интерсепторы. Всё это — явная инициализация в `app` с cleanup.
- Нет мутируемых синглтонов уровня модуля для пользовательских данных.

---

## 10. Комментарии

- Комментарий объясняет **почему** (ограничение, неочевидное решение,
  ссылка на баг/задачу), а не **что** — «что» должно быть видно из имён.
- JSDoc — на публичном API слайса и на контрактах `deps`, где семантика не
  очевидна из типа (что значит `null`, кто показывает подтверждение).
- `TODO` — с причиной и ссылкой на задачу.
- Закомментированный код удаляется.
- Осознанное отступление от правил этого документа (например, cross-import)
  сопровождается комментарием с причиной.

---

## 11. Линтер границ и полезные правила

Границы слоёв должны проверяться автоматически. Варианты:

- **Steiger** — официальный линтер FSD: `npx steiger ./src`.
- **eslint-plugin-boundaries** — правила в ESLint. Пример ниже — для
  версий 5–6. В версии 7 правила `element-types` и `entry-point` заменены на
  одно `boundaries/dependencies` с policies; проверенный конфиг v7 —
  в `frontend-bootstrap` (`references/configs.md`, раздел ESLint) и в
  шаблоне `frontend-starter`. Сверяйся с документацией установленной версии:

```js
// eslint.config.js (фрагмент)
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
      // импорт только вниз; внутри своего слайса — можно
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
      // снаружи слайса — только через index.ts
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
    // testing.ts слайсов — только из тестов
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

Правила, которые механически ловят ошибки из этого документа:

| Правило | Ловит |
|---|---|
| `@typescript-eslint/no-floating-promises` | забытый `await` / необработанный Promise |
| `@typescript-eslint/no-misused-promises` | async-функция там, где ждут void (обработчики) |
| `@typescript-eslint/no-explicit-any` | `any` |
| `@typescript-eslint/switch-exhaustiveness-check` | неполный `switch` по union |
| `@typescript-eslint/consistent-type-imports` | смешение типов и значений в импортах |
| `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps` | ошибки хуков, устаревшие замыкания |
| `no-restricted-syntax` / `no-restricted-properties` на `process.env` вне `shared/config` | чтение env в произвольных местах |

---

## 12. Производительность

- Не оптимизируй заранее: `memo`/`useMemo`/`useCallback` — когда есть
  измеренная проблема, стабильность ссылки нужна контракту (deps в
  контексте, зависимости эффектов) или вычисление действительно дорогое.
  Если проект использует React Compiler — ручная мемоизация обычно не нужна.
- Селекторы сторов возвращают стабильные ссылки (`state-and-data.md`, 6.3).
- Длинные списки (сотни+ элементов) — виртуализация.
- Код делится по страницам (lazy-импорт на уровне роутинга); тяжёлые
  редко используемые фичи (редакторы, графики) — lazy внутри страницы.
- Изображения — с размерами и ленивой загрузкой.
