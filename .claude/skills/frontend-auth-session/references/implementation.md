# Authentication in Next.js: code

Examples for the "BFF + HttpOnly cookie" model (SKILL.md, section 1) and the
layout from `frontend-bootstrap` (root `app/` — routes, `src/` — FSD). The
`AppError` error model comes from `fsd-frontend`. Adapt names and paths to the project.

## Contents

1. [What goes where](#1-what-goes-where)
2. [Session cookies](#2-session-cookies)
3. [Route handlers: login, refresh, logout](#3-route-handlers-login-refresh-logout)
4. [Client: interceptor with single-flight refresh](#4-client-interceptor-with-single-flight-refresh)
5. [proxy.ts: optimistic check](#5-proxyts-optimistic-check)
6. [Data Access Layer](#6-data-access-layer)
7. [Safe redirect and tests](#7-safe-redirect-and-tests)
8. [Page opened from a link with a token](#8-page-opened-from-a-link-with-a-token)

---

## 1. What goes where

```text
app/api/auth/login/route.ts         export { loginHandler as POST } from "@/shared/api/session/server"
app/api/auth/refresh/route.ts       export { refreshHandler as POST } from "@/shared/api/session/server"
app/api/auth/logout/route.ts        export { logoutHandler as POST } from "@/shared/api/session/server"
proxy.ts
src/shared/api/session/
├── cookies.ts                      server-only: names, set/clear
├── handlers.ts                     server-only: login/refresh/logout
├── dal.ts                          server-only: getSession, requireSession
├── server.ts                       public API of the server part
├── authorized-fetch.ts             client interceptor (factory with deps)
├── is-unauthorized.ts              detecting 401 (HTTP and GraphQL)
└── index.ts                        public API of the client part
src/shared/lib/url/safe-redirect.ts getSafeRedirect + tests
src/_app/providers/session.tsx      wires authorizedFetch with deps implementations
```

The server and client parts are exported through different entry points
(`server.ts` and `index.ts`) so that a client import doesn't pull in
`server-only` modules.

---

## 2. Session cookies

```ts
// src/shared/api/session/cookies.ts
import "server-only";
import { cookies } from "next/headers";
import { serverEnv } from "@/shared/config/env.server";

const isProd = serverEnv.NODE_ENV === "production";

// __Host- requires Secure; over http in development use names without the prefix
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

// exp is read without verifying the signature: it only sets the cookie lifetime, not access.
// If tokens are opaque, take the lifetime from the backend response (expiresIn).
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
import { backendAuth } from "../backend-auth"; // calls to the backend's auth endpoints
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
    // Backend rejected the token — the session is gone. Backend unavailable — leave the session alone.
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
    // revocation failed — delete the cookies anyway, the user must be signed out
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
  // fieldErrors are field codes, not backend texts; the UI translates them
  return json({ kind: error.kind, fieldErrors: error.details.fieldErrors }, status[error.kind]);
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status });
```

`reportError` is the monitoring port (`frontend-bootstrap`,
`references/next-structure.md`, section 8); `serverEnv.APP_URL` is the app's
public URL from the server config. For `429`, add `Retry-After` to the
response if the backend provided it.

---

## 4. Client: interceptor with single-flight refresh

```ts
// src/shared/api/session/is-unauthorized.ts
type GraphqlError = { extensions?: { code?: string } };

export async function isUnauthorizedResponse(response: Response): Promise<boolean> {
  if (response.status === 401) return true;
  // GraphQL responds with 200 to auth errors too
  const body: unknown = await response.clone().json().catch(() => null);
  const errors = (body as { errors?: GraphqlError[] } | null)?.errors;
  return Array.isArray(errors) && errors.some((e) => e.extensions?.code === "UNAUTHENTICATED");
}
```

```ts
// src/shared/api/session/authorized-fetch.ts
import { AppError } from "../app-error";

export type AuthorizedFetchDeps = {
  /** true — a new pair was issued; false — the backend rejected the refresh; throw — network/5xx. */
  refreshSession: () => Promise<boolean>;
  /** Session lost: clear the cache and stores, go to sign-in. */
  onSessionExpired: () => void;
  isUnauthorized: (response: Response) => Promise<boolean>;
};

export function createAuthorizedFetch(deps: AuthorizedFetchDeps) {
  let refreshing: Promise<boolean> | null = null;
  let loggingOut = false;
  let expired = false;

  // all waiters get the result of a single refresh
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

  // several failed requests — a single redirect to sign-in
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
      // a transient failure is no reason to sign out
      throw new AppError("network", "Session refresh failed", { cause: error });
    }

    if (!refreshed) {
      expireOnce();
      return response;
    }

    // one retry; a second 401 means the session is lost, no new refresh
    const retried = await fetch(input, { ...init, credentials: "include" });
    if (await deps.isUnauthorized(retried)) expireOnce();
    return retried;
  }

  return {
    authorizedFetch,
    /** Set before the logout request and unset if logout failed. */
    setLoggingOut: (value: boolean) => {
      loggingOut = value;
    },
  };
}
```

```tsx
// src/_app/providers/session.tsx — deps implementations are visible only here
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createAuthorizedFetch, isUnauthorizedResponse } from "@/shared/api/session";

export function useAuthorizedFetchSetup() {
  const queryClient = useQueryClient();

  return useState(() =>
    createAuthorizedFetch({
      // refresh uses plain fetch, bypassing the interceptor
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

`request()` from `frontend-bootstrap` gets `authorizedFetch` instead of the
global `fetch` (as a parameter or through a port), so the rest of the code
doesn't know about refresh.

---

## 5. proxy.ts: optimistic check

```ts
// proxy.ts (Next 16+; in Next 15 — middleware.ts with a middleware function)
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/app"];
const AUTH_ONLY_FOR_GUESTS = ["/sign-in", "/sign-up"];
// keep cookie names in one module without server-only so it can be imported here too
const REFRESH_COOKIES = ["__Host-refresh", "refresh"];

const matches = (pathname: string, routes: string[]) =>
  routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

export default function proxy(request: NextRequest) {
  // refresh, not access: access may have expired while the session is alive
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

This doesn't protect data: the same request without cookies to a route
handler or Server Action must be rejected there (section 6).

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

// cache deduplicates within a single render; it has no effect in handlers and actions
export const getSession = cache(async (): Promise<Session | null> => {
  const accessToken = (await cookies()).get(SESSION_COOKIES.access)?.value;
  // The signature is verified if the backend publishes keys (JWKS + jose).
  // Otherwise only presence is checked here, and verification happens on the backend for every request.
  return accessToken ? { accessToken } : null;
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}
```

A server-side API request on behalf of the user passes the token explicitly
(`Authorization: Bearer` or a cookie): a server-side `fetch` doesn't send the
browser's cookies on its own.

---

## 7. Safe redirect and tests

```ts
// src/shared/lib/url/safe-redirect.ts
/**
 * Returns a path inside the app, or the fallback.
 * The result is always a relative path that can be passed to the router or location.
 */
export function getSafeRedirect(
  raw: string | null | undefined,
  fallback: string,
  appOrigin: string,
): string {
  if (!raw) return fallback;
  // Browsers turn "\" into "/" and drop tabs and newlines:
  // "/\evil.com" and "/\t/evil.com" become "//evil.com"
  if (/[\\\u0000-\u001F\u007F]/.test(raw)) return fallback;

  let url: URL;
  try {
    url = new URL(raw, appOrigin);
  } catch {
    return fallback; // not a URL, so not an app path
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
])("accepts the app path %s", (raw, expected) => {
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
  "http://app.example.com/texts", // a different protocol is a different origin
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
])("rejects %s", (raw) => {
  expect(safe(raw)).toBe("/app");
});
```

---

## 8. Page opened from a link with a token

```tsx
// src/_pages/password-reset/ui/password-reset-page.tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function PasswordResetPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // read once; after that the token lives only in state
  const [token] = useState(() => searchParams.get("token"));

  useEffect(() => {
    // remove the token from the address bar and history
    if (searchParams.has("token")) router.replace(pathname);
  }, [pathname, router, searchParams]);

  if (!token) return <ResetLinkInvalid />;
  return <SetNewPasswordForm token={token} />;
}
```

```ts
// next.config.ts (headers() fragment): no Referer from this page either
{ source: "/password-reset", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }
```

A page using `useSearchParams` is wrapped in `<Suspense>` where it is used;
otherwise the build moves the whole route to client rendering.
