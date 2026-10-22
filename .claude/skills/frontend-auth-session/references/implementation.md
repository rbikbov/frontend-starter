# Авторизация в Next.js: код

Примеры для модели «BFF + HttpOnly-cookie» (SKILL.md, раздел 1) и раскладки
из `frontend-bootstrap` (корневой `app/` — маршруты, `src/` — FSD). Модель
ошибок `AppError` — из `fsd-frontend`. Имена и пути адаптируй к проекту.

## Содержание

1. [Где что лежит](#1-где-что-лежит)
2. [Cookie сессии](#2-cookie-сессии)
3. [Route handlers: login, refresh, logout](#3-route-handlers-login-refresh-logout)
4. [Клиент: перехватчик с single-flight refresh](#4-клиент-перехватчик-с-single-flight-refresh)
5. [proxy.ts: оптимистичная проверка](#5-proxyts-оптимистичная-проверка)
6. [Data Access Layer](#6-data-access-layer)
7. [Безопасный редирект и тесты](#7-безопасный-редирект-и-тесты)
8. [Страница по ссылке с токеном](#8-страница-по-ссылке-с-токеном)

---

## 1. Где что лежит

```text
app/api/auth/login/route.ts         export { loginHandler as POST } from "@/shared/api/session/server"
app/api/auth/refresh/route.ts       export { refreshHandler as POST } from "@/shared/api/session/server"
app/api/auth/logout/route.ts        export { logoutHandler as POST } from "@/shared/api/session/server"
proxy.ts
src/shared/api/session/
├── cookies.ts                      server-only: имена, set/clear
├── handlers.ts                     server-only: login/refresh/logout
├── dal.ts                          server-only: getSession, requireSession
├── server.ts                       public API серверной части
├── authorized-fetch.ts             клиентский перехватчик (фабрика с deps)
├── is-unauthorized.ts              определение 401 (HTTP и GraphQL)
└── index.ts                        public API клиентской части
src/shared/lib/url/safe-redirect.ts getSafeRedirect + тесты
src/_app/providers/session.tsx      сборка authorizedFetch с реализациями deps
```

Серверная и клиентская части экспортируются разными входами (`server.ts` и
`index.ts`), чтобы клиентский импорт не тянул `server-only` модули.

---

## 2. Cookie сессии

```ts
// src/shared/api/session/cookies.ts
import "server-only";
import { cookies } from "next/headers";
import { serverEnv } from "@/shared/config/env.server";

const isProd = serverEnv.NODE_ENV === "production";

// __Host- требует Secure; на http в разработке используем имена без префикса
export const SESSION_COOKIES = {
  access: isProd ? "__Host-access" : "access",
  refresh: isProd ? "__Host-refresh" : "refresh",
} as const;

const base = { httpOnly: true, secure: isProd, sameSite: "lax", path: "/" } as const;

export type TokenPair = { accessToken: string; refreshToken: string };

export async function setSessionCookies({ accessToken, refreshToken }: TokenPair) {
  const store = await cookies();
  store.set(SESSION_COOKIES.access, accessToken, { ...base, expires: tokenExpiry(accessToken) });
  store.set(SESSION_COOKIES.refresh, refreshToken, { ...base, expires: tokenExpiry(refreshToken) });
}

export async function clearSessionCookies() {
  const store = await cookies();
  store.delete(SESSION_COOKIES.access);
  store.delete(SESSION_COOKIES.refresh);
}

// exp читается без проверки подписи: он задаёт только срок жизни cookie, не доступ.
// Если токены непрозрачные — бери срок из ответа бэкенда (expiresIn).
function tokenExpiry(jwt: string): Date | undefined {
  const payload = jwt.split(".")[1];
  if (!payload) return undefined;
  const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: number };
  return typeof exp === "number" ? new Date(exp * 1000) : undefined;
}
```

---

## 3. Route handlers: login, refresh, logout

```ts
// src/shared/api/session/handlers.ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { serverEnv } from "@/shared/config/env.server";
import { reportError } from "@/shared/lib/monitoring";
import { AppError, toAppError } from "../app-error";
import { backendAuth } from "../backend-auth"; // вызовы auth-эндпоинтов бэкенда
import { clearSessionCookies, SESSION_COOKIES, setSessionCookies } from "./cookies";

const LoginBody = z.object({ email: z.email(), password: z.string().min(1) });

export async function loginHandler(request: NextRequest) {
  if (!isSameOrigin(request)) return json({ kind: "forbidden" }, 403);

  const body = LoginBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ kind: "validation" }, 400);

  try {
    const tokens = await backendAuth.login(body.data, clientContext(request));
    await setSessionCookies(tokens);
    return json({ ok: true }, 200);
  } catch (error) {
    return errorResponse(toAppError(error));
  }
}

export async function refreshHandler(request: NextRequest) {
  if (!isSameOrigin(request)) return json({ kind: "forbidden" }, 403);

  const refreshToken = (await cookies()).get(SESSION_COOKIES.refresh)?.value;
  if (!refreshToken) return json({ kind: "unauthorized" }, 401);

  try {
    await setSessionCookies(await backendAuth.refresh(refreshToken, clientContext(request)));
    return json({ ok: true }, 200);
  } catch (error) {
    const appError = toAppError(error);
    // Бэкенд отклонил токен — сессии больше нет. Бэкенд недоступен — сессию не трогаем.
    if (appError.kind === "unauthorized" || appError.kind === "validation") {
      await clearSessionCookies();
      return json({ kind: "unauthorized" }, 401);
    }
    return errorResponse(appError);
  }
}

export async function logoutHandler(request: NextRequest) {
  if (!isSameOrigin(request)) return json({ kind: "forbidden" }, 403);

  const refreshToken = (await cookies()).get(SESSION_COOKIES.refresh)?.value;
  try {
    if (refreshToken) await backendAuth.logout(refreshToken, clientContext(request));
  } catch (error) {
    // отзыв не удался — cookie всё равно удаляем, пользователь должен выйти
    reportError(error);
  } finally {
    await clearSessionCookies();
  }
  return json({ ok: true }, 200);
}

function isSameOrigin(request: NextRequest) {
  return request.headers.get("origin") === new URL(serverEnv.APP_URL).origin;
}

function clientContext(request: NextRequest) {
  return {
    forwardedFor: request.headers.get("x-forwarded-for") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  };
}

function errorResponse(error: AppError) {
  const status: Record<AppError["kind"], number> = {
    network: 503, unauthorized: 401, forbidden: 403, "not-found": 404,
    validation: 422, conflict: 409, aborted: 499, unknown: 502,
  };
  // fieldErrors — коды полей, а не тексты бэкенда; тексты переводит UI
  return json({ kind: error.kind, fieldErrors: error.details.fieldErrors }, status[error.kind]);
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status });
```

`reportError` — порт мониторинга (`frontend-bootstrap`,
`references/next-structure.md`, раздел 8); `serverEnv.APP_URL` — публичный
адрес приложения из серверного конфига. Для `429` добавь в ответ
`Retry-After`, если бэкенд его отдал.

---

## 4. Клиент: перехватчик с single-flight refresh

```ts
// src/shared/api/session/is-unauthorized.ts
type GraphqlError = { extensions?: { code?: string } };

export async function isUnauthorizedResponse(response: Response): Promise<boolean> {
  if (response.status === 401) return true;
  // GraphQL отвечает 200 и на ошибки авторизации
  const body: unknown = await response.clone().json().catch(() => null);
  const errors = (body as { errors?: GraphqlError[] } | null)?.errors;
  return Array.isArray(errors) && errors.some((e) => e.extensions?.code === "UNAUTHENTICATED");
}
```

```ts
// src/shared/api/session/authorized-fetch.ts
import { AppError } from "../app-error";

export type AuthorizedFetchDeps = {
  /** true — выдана новая пара; false — бэкенд отклонил refresh; throw — сеть/5xx. */
  refreshSession: () => Promise<boolean>;
  /** Сессия потеряна: очистить кэш и сторы, увести на вход. */
  onSessionExpired: () => void;
  isUnauthorized: (response: Response) => Promise<boolean>;
};

export function createAuthorizedFetch(deps: AuthorizedFetchDeps) {
  let refreshing: Promise<boolean> | null = null;
  let loggingOut = false;
  let expired = false;

  // все ждущие получают результат одного refresh
  const refreshOnce = () => {
    refreshing ??= deps
      .refreshSession()
      .then((ok) => {
        if (ok) expired = false;
        return ok;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  // несколько упавших запросов — один выход на страницу входа
  const expireOnce = () => {
    if (expired) return;
    expired = true;
    deps.onSessionExpired();
  };

  async function authorizedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await fetch(input, { ...init, credentials: "include" });
    if (loggingOut || !(await deps.isUnauthorized(response))) return response;

    let refreshed: boolean;
    try {
      refreshed = await refreshOnce();
    } catch (error) {
      // временный сбой — не повод разлогинивать
      throw new AppError("network", "Session refresh failed", { cause: error });
    }

    if (!refreshed) {
      expireOnce();
      return response;
    }

    // один повтор; второй 401 — сессия потеряна, без нового refresh
    const retried = await fetch(input, { ...init, credentials: "include" });
    if (await deps.isUnauthorized(retried)) expireOnce();
    return retried;
  }

  return {
    authorizedFetch,
    /** Вызвать до запроса logout и снять, если logout не удался. */
    setLoggingOut: (value: boolean) => {
      loggingOut = value;
    },
  };
}
```

```tsx
// src/_app/providers/session.tsx — реализации deps видны только здесь
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createAuthorizedFetch, isUnauthorizedResponse } from "@/shared/api/session";

export function useAuthorizedFetchSetup() {
  const queryClient = useQueryClient();

  return useState(() =>
    createAuthorizedFetch({
      // refresh идёт обычным fetch, мимо перехватчика
      refreshSession: async () => {
        const response = await fetch("/api/auth/refresh", { method: "POST" });
        if (response.ok) return true;
        if (response.status === 401) return false;
        throw new Error(`Refresh failed with ${response.status}`);
      },
      onSessionExpired: () => {
        queryClient.clear();
        const callbackUrl = window.location.pathname + window.location.search;
        window.location.assign(`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      },
      isUnauthorized: isUnauthorizedResponse,
    }),
  )[0];
}
```

`request()` из `frontend-bootstrap` получает `authorizedFetch` вместо
глобального `fetch` (параметром или через порт) — так остальной код не знает
про refresh.

---

## 5. proxy.ts: оптимистичная проверка

```ts
// proxy.ts (Next 16+; в Next 15 — middleware.ts с функцией middleware)
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/app"];
const AUTH_ONLY_FOR_GUESTS = ["/sign-in", "/sign-up"];
// имена cookie держи в одном модуле без server-only, чтобы импортировать и сюда
const REFRESH_COOKIES = ["__Host-refresh", "refresh"];

const matches = (pathname: string, routes: string[]) =>
  routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

export default function proxy(request: NextRequest) {
  // refresh, а не access: access мог истечь, а сессия жива
  const hasSession = REFRESH_COOKIES.some((name) => request.cookies.has(name));
  const { pathname, search } = request.nextUrl;

  if (matches(pathname, PROTECTED) && !hasSession) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(signIn);
  }

  if (matches(pathname, AUTH_ONLY_FOR_GUESTS) && hasSession) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
```

Это не защита данных: тот же запрос без cookie к route handler или Server
Action должен быть отклонён там (раздел 6).

---

## 6. Data Access Layer

```ts
// src/shared/api/session/dal.ts
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIES } from "./cookies";

export type Session = { accessToken: string };

// cache — дедупликация в пределах одного рендера; в handlers и actions не действует
export const getSession = cache(async (): Promise<Session | null> => {
  const accessToken = (await cookies()).get(SESSION_COOKIES.access)?.value;
  // Подпись проверяется, если бэкенд публикует ключи (JWKS + jose).
  // Иначе здесь только наличие, а проверка — на бэкенде при каждом запросе.
  return accessToken ? { accessToken } : null;
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}
```

Серверный запрос к API от имени пользователя явно передаёт токен
(`Authorization: Bearer` или cookie) — серверный `fetch` не отправляет cookie
браузера сам.

---

## 7. Безопасный редирект и тесты

```ts
// src/shared/lib/url/safe-redirect.ts
/**
 * Возвращает путь внутри приложения или fallback.
 * Результат — всегда относительный путь, его можно передать в router или location.
 */
export function getSafeRedirect(
  raw: string | null | undefined,
  fallback: string,
  appOrigin: string,
): string {
  if (!raw) return fallback;
  // Браузеры превращают "\" в "/" и выбрасывают табы и переводы строк:
  // "/\evil.com" и "/\t/evil.com" становятся "//evil.com"
  if (/[\\\u0000-\u001F\u007F]/.test(raw)) return fallback;

  let url: URL;
  try {
    url = new URL(raw, appOrigin);
  } catch {
    return fallback; // не URL — значит, не путь приложения
  }
  if (url.origin !== new URL(appOrigin).origin) return fallback;
  return url.pathname + url.search + url.hash;
}
```

```ts
// src/shared/lib/url/safe-redirect.test.ts
const origin = "https://app.example.com";
const safe = (raw: string | null) => getSafeRedirect(raw, "/app", origin);

it.each([
  ["/texts/1?tab=notes", "/texts/1?tab=notes"],
  ["https://app.example.com/texts", "/texts"],
])("принимает путь приложения %s", (raw, expected) => {
  expect(safe(raw)).toBe(expected);
});

it.each([
  null,
  "",
  "//evil.com",
  "/\\evil.com",
  "\\\\evil.com",
  "/\t/evil.com",
  "/\n/evil.com",
  "https://evil.com",
  "https://app.example.com.evil.com",
  "http://app.example.com/texts", // другой протокол — другой origin
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
])("отклоняет %s", (raw) => {
  expect(safe(raw)).toBe("/app");
});
```

---

## 8. Страница по ссылке с токеном

```tsx
// src/_pages/password-reset/ui/password-reset-page.tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function PasswordResetPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // читаем один раз; дальше токен живёт только в состоянии
  const [token] = useState(() => searchParams.get("token"));

  useEffect(() => {
    // убираем токен из адресной строки и истории
    if (searchParams.has("token")) router.replace(pathname);
  }, [pathname, router, searchParams]);

  if (!token) return <ResetLinkInvalid />;
  return <SetNewPasswordForm token={token} />;
}
```

```ts
// next.config.ts (фрагмент headers()): без Referer и с этой страницы
{ source: "/password-reset", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }
```

Страница с `useSearchParams` оборачивается в `<Suspense>` в месте
использования — иначе сборка уводит весь маршрут в клиентский рендер.
