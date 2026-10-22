# Next.js + FSD: раскладка и базовый код

## Содержание

1. [Маршруты: тонкие файлы в корневом app/](#1-маршруты-тонкие-файлы-в-корневом-app)
2. [Корневой лейаут и провайдеры](#2-корневой-лейаут-и-провайдеры)
3. [Серверные данные и TanStack Query](#3-серверные-данные-и-tanstack-query)
4. [Конфигурация окружения](#4-конфигурация-окружения)
5. [API-клиент: request() и ошибки](#5-api-клиент-request-и-ошибки)
6. [Границы ошибок маршрутов](#6-границы-ошибок-маршрутов)
7. [Сервер и клиент: где что можно](#7-сервер-и-клиент-где-что-можно)
8. [Логи и мониторинг как порт](#8-логи-и-мониторинг-как-порт)

---

## 1. Маршруты: тонкие файлы в корневом app/

```text
app/
├── layout.tsx
├── not-found.tsx
├── error.tsx
├── (marketing)/page.tsx
├── (auth)/sign-in/page.tsx
└── (app)/texts/[id]/page.tsx
src/_pages/
├── home/index.ts
├── sign-in/index.ts
└── text/index.ts
```

```tsx
// app/(app)/texts/[id]/page.tsx — разобрать вход, отдать странице FSD
import type { Metadata } from "next";
import { TextPage, getTextPageMetadata } from "@/_pages/text";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return getTextPageMetadata(id);
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <TextPage textId={id} />;
}
```

- Файл маршрута не содержит JSX сложнее вызова страницы и не импортирует
  `features`/`entities` напрямую — только `@/_pages/*` и `@/_app`.
- `searchParams` разбирается и валидируется в странице FSD (хук или функция
  `parse<Page>Params`), некорректное значение → значение по умолчанию.
- Группы маршрутов `(auth)`, `(app)` — для разных лейаутов, а не для
  «красоты» дерева.

---

## 2. Корневой лейаут и провайдеры

```tsx
// app/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppProviders, fontVariables } from "@/_app";
import "@/_app/styles/globals.css";

export const metadata: Metadata = {
  title: { default: "<Название>", template: "%s · <Название>" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={fontVariables}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
```

```tsx
// src/_app/providers/app-providers.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createQueryClient } from "@/shared/api";

export function AppProviders({ children }: { children: ReactNode }) {
  // useState, а не модульная переменная: на сервере модуль общий для всех запросов
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {/* i18n, тема, ToastProvider/ConfirmProvider с реализациями из _app */}
      {children}
    </QueryClientProvider>
  );
}
```

```ts
// src/shared/api/query-client.ts
import { QueryClient } from "@tanstack/react-query";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // без staleTime данные, пришедшие с сервера, сразу перезапрашиваются на клиенте
      queries: { staleTime: 60_000 },
    },
  });
}
```

---

## 3. Серверные данные и TanStack Query

Два законных способа, не смешивай их для одних и тех же данных:

| Данные | Способ |
|---|---|
| Нужны для первого рендера, меняются редко, не нужны клиентским хукам | `await` в Server Component, результат — пропсами |
| Нужны интерактивным клиентским компонентам (мутации, инвалидация, polling) | prefetch на сервере + `HydrationBoundary`, дальше `useQuery` на клиенте |

```tsx
// src/_pages/text/ui/text-page.tsx — серверный компонент страницы
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createQueryClient } from "@/shared/api";
import { textQueries } from "@/entities/text";
import { TextEditor } from "@/features/edit-text";

export async function TextPage({ textId }: { textId: string }) {
  const queryClient = createQueryClient(); // новый на каждый запрос
  await queryClient.prefetchQuery(textQueries.detail(textId));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TextEditor textId={textId} />
    </HydrationBoundary>
  );
}
```

- `queryFn` в фабрике запросов должна работать и на сервере, и в браузере:
  абсолютный URL на сервере, относительный — в браузере (или один базовый URL
  из конфига).
- Cookie пользователя на сервере `fetch` сам не отправляет: серверный
  запрос к API от имени пользователя явно пробрасывает их (см.
  `frontend-auth-session`).

---

## 4. Конфигурация окружения

```ts
// src/shared/config/env.server.ts
import "server-only";
import { z } from "zod";

const schema = z.object({
  API_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]),
});

// Валидация при импорте — сознательное исключение из правила «импорт без побочных эффектов»:
// она ничего не меняет снаружи и падает при старте, а не на первом запросе.
export const serverEnv = schema.parse({
  API_URL: process.env.API_URL,
  NODE_ENV: process.env.NODE_ENV,
});
```

```ts
// src/shared/config/env.client.ts
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
});

export const clientEnv = schema.parse({
  // NEXT_PUBLIC_* подставляются при сборке только при прямом обращении:
  // без деструктуризации process.env и без process.env[name]
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
```

```ts
// src/shared/config/index.ts — только клиентская часть; серверная импортируется явно
export { clientEnv } from "./env.client";
```

Серверный конфиг импортируется путём `@/shared/config/env.server`: так по
импорту видно, что модуль серверный, а `server-only` сломает сборку, если он
попадёт в клиентский бандл.

---

## 5. API-клиент: request() и ошибки

Модель `AppError` и `toAppError` — `fsd-frontend`,
`references/conventions.md`, раздел 1. Здесь — транспорт поверх `fetch`.

```ts
// src/shared/api/request.ts
import type { z } from "zod";
import { AppError, type AppErrorKind } from "./app-error";

type RequestOptions<T> = Omit<RequestInit, "body"> & {
  schema: z.ZodType<T>;
  body?: unknown;
};

export async function request<T>(
  url: string,
  { schema, body, headers, ...init }: RequestOptions<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError("aborted", "Request aborted", { cause: error });
    }
    throw new AppError("network", "Network error", { cause: error });
  }

  // тело может быть пустым или не JSON (HTML от прокси) — это не повод терять статус
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new AppError(kindFromStatus(response.status), `HTTP ${response.status}`, {
      status: response.status,
      fieldErrors: readFieldErrors(payload),
      cause: payload,
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("unknown", "Response does not match the contract", {
      status: response.status,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function kindFromStatus(status: number): AppErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "validation";
  return "unknown";
}

// Формат ошибок полей зависит от бэкенда: опиши его схемой и разбери здесь, один раз.
function readFieldErrors(payload: unknown): Record<string, string> | undefined {
  void payload;
  return undefined;
}
```

**GraphQL** отвечает `200` и на ошибки: после `request()` проверь `errors`
целиком и определи `kind` по `extensions.code`; по тексту сообщения — только
если бэкенд не отдаёт кодов, в одном маппере, с тестами.

```ts
const AUTH_CODES = new Set(["UNAUTHENTICATED"]);

function graphqlErrorKind(errors: { message: string; extensions?: { code?: string } }[]): AppErrorKind {
  if (errors.some((e) => AUTH_CODES.has(e.extensions?.code ?? ""))) return "unauthorized";
  if (errors.some((e) => e.extensions?.code === "BAD_USER_INPUT")) return "validation";
  return "unknown";
}
```

Тесты на `request()` — MSW: сетевой сбой, каждый статус, пустое тело,
HTML вместо JSON, ответ не по схеме, отмена через `AbortController`.

---

## 6. Границы ошибок маршрутов

- `app/error.tsx` (и в сегментах, где нужен свой фолбэк) — клиентский
  компонент с пропсами `{ error: unknown; retry: () => void }`: показывает
  переведённое сообщение и кнопку «Повторить» (`retry()` с Next 16.2 —
  перезапрашивает и перерисовывает сегмент; `reset()` только сбрасывает
  состояние границы), отправляет ошибку в `reportError`. Текст ошибки
  сервера пользователю не показывается.
- `app/global-error.tsx` — для ошибок в корневом лейауте; рендерит свои
  `<html>` и `<body>`.
- `app/not-found.tsx` — для `notFound()` и несуществующих путей.
- `loading.tsx` — только там, где сегмент реально грузит данные; скелетон
  повторяет раскладку, а не крутит спиннер на весь экран.
- С `cacheComponents` (по умолчанию в новых проектах) route handler и
  страница без request-time API пререндерятся при сборке. Ответ на каждый
  запрос — `await connection()` из `next/server` или `cookies()`/`headers()`.
  Пример — проверка живости `/api/health`: без `connection()` она отвечает
  результатом сборки и ничего не говорит о живом сервере.

---

## 7. Сервер и клиент: где что можно

| Модуль | Первая строка | Что можно |
|---|---|---|
| Работа с секретами, cookie, серверный env | `import "server-only"` | `cookies()`, `headers()`, серверный `fetch` |
| Компонент с состоянием, эффектами, обработчиками | `"use client"` | хуки, `window`, браузерные API |
| Модуль, который трогает `window`/`localStorage` вне компонентов | `import "client-only"` | браузерные API |
| Всё остальное | ничего | чистые функции, типы, серверные компоненты |

- `"use client"` делает клиентским весь подграф импортов. Ставь его на
  лист с интерактивом, а не на страницу.
- В клиентский компонент из серверного передаются только сериализуемые
  пропсы. Функции — только Server Actions.
- Данные пользователя не кладутся в модульные переменные на сервере: модуль
  живёт между запросами разных пользователей.

---

## 8. Логи и мониторинг как порт

```ts
// src/shared/lib/monitoring/index.ts
export type Logger = {
  info: (event: string, context?: Record<string, string | number | boolean>) => void;
  error: (event: string, error: unknown, context?: Record<string, string | number | boolean>) => void;
};
```

- Реализация — в `_app` (в разработке `console`, в продакшене — сервис
  мониторинга); на сервере инициализация — в `instrumentation.ts`.
- Контекст — id, `kind`, имя операции. Не email, не токены, не тела
  запросов. Тип контекста не принимает объекты, чтобы в лог нельзя было
  целиком передать запрос или пользователя; строки с персональными данными
  он не остановит — это на ревью.
- Подключать Sentry и аналоги в день ноль не обязательно; порт — обязательно,
  чтобы потом не переписывать вызовы.
