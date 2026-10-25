# app/ — Next.js routes

- A route file is thin: re-export a page from `@/_pages/*`, `generateMetadata`, parsing
  `params` and `searchParams` (they are a `Promise` — `await` them) and passing them as
  props. No logic.
- Only `@/_app`, `@/_pages/*` (through `index.ts`) and `@/shared/*` may be imported — the
  linter checks this.
- Route handlers and Server Actions are public endpoints: input is validated with a zod
  schema, and authorization is checked in each of them, not in `proxy.ts`.
- `cacheComponents` is enabled: a handler or page without a request-time API is prerendered
  at build time. To respond per request, use `await connection()` from `next/server` or
  `cookies()`/`headers()` (example: `api/health/route.ts`). User data never goes into
  `"use cache"`.
- `"use client"` goes as low in the tree as possible, not on the whole page.
- Error boundaries: `error.tsx` receives `{ error: unknown; retry: () => void }`;
  `global-error.tsx` renders its own `<html>` and `<body>` without global styles.
- Before using a new file convention (`loading`, `template`, `proxy`, parallel routes),
  read its page in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`.
