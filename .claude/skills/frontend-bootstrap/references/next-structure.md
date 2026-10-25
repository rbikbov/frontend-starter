# Next.js + FSD: layout and base code

## Contents

1. [Routes: thin files in the root app/](#1-routes-thin-files-in-the-root-app)
2. [Root layout and providers](#2-root-layout-and-providers)
3. [Server data and TanStack Query](#3-server-data-and-tanstack-query)
4. [Environment configuration](#4-environment-configuration)
5. [API client: request() and errors](#5-api-client-request-and-errors)
6. [Route error boundaries](#6-route-error-boundaries)
7. [Server and client: what goes where](#7-server-and-client-what-goes-where)
8. [Logging and monitoring as a port](#8-logging-and-monitoring-as-a-port)

---

## 1. Routes: thin files in the root app/

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
// app/(app)/texts/[id]/page.tsx — parse the input, hand it to the FSD page
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

- A route file contains no JSX more complex than rendering the page and
  doesn't import `features`/`entities` directly — only `@/_pages/*` and `@/_app`.
- `searchParams` are parsed and validated in the FSD page (a hook or a
  `parse<Page>Params` function); an invalid value → the default value.
- Route groups `(auth)`, `(app)` are for different layouts, not for a
  "prettier" tree.

---

## 2. Root layout and providers

```tsx
// app/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppProviders, fontVariables } from "@/_app";
import "@/_app/styles/globals.css";

export const metadata: Metadata = {
  title: { default: "<Name>", template: "%s · <Name>" },
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
  // useState, not a module variable: on the server the module is shared across all requests
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {/* i18n, theme, ToastProvider/ConfirmProvider with implementations from _app */}
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
      // without staleTime, data from the server is refetched on the client right away
      queries: { staleTime: 60_000 },
    },
  });
}
```

---

## 3. Server data and TanStack Query

Two legitimate approaches; don't mix them for the same data:

| Data | Approach |
|---|---|
| Needed for the first render, rarely change, not needed by client hooks | `await` in a Server Component, pass the result as props |
| Needed by interactive client components (mutations, invalidation, polling) | prefetch on the server + `HydrationBoundary`, then `useQuery` on the client |

```tsx
// src/_pages/text/ui/text-page.tsx — the page's server component
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createQueryClient } from "@/shared/api";
import { textQueries } from "@/entities/text";
import { TextEditor } from "@/features/edit-text";

export async function TextPage({ textId }: { textId: string }) {
  const queryClient = createQueryClient(); // a new one for every request
  await queryClient.prefetchQuery(textQueries.detail(textId));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TextEditor textId={textId} />
    </HydrationBoundary>
  );
}
```

- The `queryFn` in a query factory must work both on the server and in the
  browser: an absolute URL on the server, a relative one in the browser (or a
  single base URL from the config).
- On the server, `fetch` doesn't send the user's cookies by itself: a server-side
  API request on behalf of the user forwards them explicitly (see
  `frontend-auth-session`).

---

## 4. Environment configuration

```ts
// src/shared/config/env.server.ts
import "server-only";
import { z } from "zod";

const schema = z.object({
  API_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]),
});

// Validation on import is a deliberate exception to the "imports without side effects" rule:
// it changes nothing outside and fails at startup, not on the first request.
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
  // NEXT_PUBLIC_* are inlined at build time only on direct access:
  // no destructuring of process.env and no process.env[name]
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
```

```ts
// src/shared/config/index.ts — client part only; the server part is imported explicitly
export { clientEnv } from "./env.client";
```

The server config is imported as `@/shared/config/env.server`: the import
shows the module is server-only, and `server-only` breaks the build if it ends
up in the client bundle.

---

## 5. API client: request() and errors

The `AppError` model and `toAppError` — `fsd-frontend`,
`references/conventions.md`, section 1. Here — the transport over `fetch`.

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

  // the body may be empty or not JSON (HTML from a proxy) — no reason to lose the status
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

// The field error format depends on the backend: describe it with a schema and parse it here, once.
function readFieldErrors(payload: unknown): Record<string, string> | undefined {
  void payload;
  return undefined;
}
```

**GraphQL** responds with `200` to errors too: after `request()` check the
whole `errors` array and derive `kind` from `extensions.code`; by message text
only if the backend provides no codes, in a single mapper, with tests.

```ts
const AUTH_CODES = new Set(["UNAUTHENTICATED"]);

function graphqlErrorKind(errors: { message: string; extensions?: { code?: string } }[]): AppErrorKind {
  if (errors.some((e) => AUTH_CODES.has(e.extensions?.code ?? ""))) return "unauthorized";
  if (errors.some((e) => e.extensions?.code === "BAD_USER_INPUT")) return "validation";
  return "unknown";
}
```

Tests for `request()` use MSW: network failure, every status, empty body,
HTML instead of JSON, a response that doesn't match the schema, abort via
`AbortController`.

---

## 6. Route error boundaries

- `app/error.tsx` (and in segments that need their own fallback) — a client
  component with props `{ error: unknown; retry: () => void }`: shows a
  translated message and a "Retry" button (`retry()` since Next 16.2
  refetches and re-renders the segment; `reset()` only resets the boundary's
  state), and sends the error to `reportError`. The server's error text is
  never shown to the user.
- `app/global-error.tsx` — for errors in the root layout; renders its own
  `<html>` and `<body>`.
- `app/not-found.tsx` — for `notFound()` and nonexistent paths.
- `loading.tsx` — only where the segment actually loads data; the skeleton
  mirrors the layout rather than spinning a full-screen spinner.
- With `cacheComponents` (the default in new projects), a route handler and a
  page without request-time APIs are prerendered at build time. For a
  per-request response use `await connection()` from `next/server` or
  `cookies()`/`headers()`. Example — the `/api/health` liveness check: without
  `connection()` it responds with the build-time result and says nothing about
  the live server.

---

## 7. Server and client: what goes where

| Module | First line | What's allowed |
|---|---|---|
| Works with secrets, cookies, server env | `import "server-only"` | `cookies()`, `headers()`, server-side `fetch` |
| Component with state, effects, handlers | `"use client"` | hooks, `window`, browser APIs |
| Module touching `window`/`localStorage` outside components | `import "client-only"` | browser APIs |
| Everything else | nothing | pure functions, types, server components |

- `"use client"` makes the whole import subgraph client-side. Put it on an
  interactive leaf, not on the page.
- Only serializable props are passed from a server component to a client one.
  Functions — only Server Actions.
- User data is never put into module variables on the server: the module lives
  across requests from different users.

---

## 8. Logging and monitoring as a port

```ts
// src/shared/lib/monitoring/index.ts
export type Logger = {
  info: (event: string, context?: Record<string, string | number | boolean>) => void;
  error: (event: string, error: unknown, context?: Record<string, string | number | boolean>) => void;
};
```

- The implementation lives in `_app` (`console` in development, a monitoring
  service in production); on the server, initialization is in `instrumentation.ts`.
- Context — id, `kind`, operation name. Not emails, tokens or request bodies.
  The context type doesn't accept objects, so a whole request or user can't be
  passed to the log; it won't stop strings with personal data — that's for review.
- Connecting Sentry or similar on day zero is optional; the port is required,
  so the calls don't have to be rewritten later.
