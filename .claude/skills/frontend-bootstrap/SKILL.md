---
name: frontend-bootstrap
description: >
  Starting a new Next.js (App Router) + TypeScript frontend project: the
  foundation laid before the first feature. Use when you need to: create a
  project from scratch; decide whether you need Next.js, a monorepo, a BFF,
  microfrontends; lay out FSD on top of Next routing; set up strict TS, a
  boundaries linter, env config, an error model and API client, tests, git
  hooks, CI, a README skeleton; clean up a young project after a generator.
---

# Starting a Next.js project

The foundation is cheapest to lay on day one: later, every rule has to be
introduced on top of code that violates it. **If the `frontend-starter`
template exists, start from a copy of it:** the steps below are already done
and verified there, and this document remains an explanation of the decisions
and an audit checklist.
This document sets
**the order of steps and the minimal set**. How to write the code itself —
the `fsd-frontend` skill (if the project has it), authentication —
`frontend-auth-session`, the pre-commit check — `anti-slop-review`.
Ready-made configs — `references/configs.md`, the Next + FSD layout with code
examples — `references/next-structure.md`.

**Rule priority.** Explicit user instructions and the project's agent files
(`AGENTS.md`, `CLAUDE.md`) take precedence over this document. Library
versions change: before copying a config, check it against the docs of the
installed version, and don't claim it works until you have run it.

**Facts about Next.js come from the docs in the package, not from this
document or from memory.** Since 16.2 the docs live in
`node_modules/next/dist/docs/`, and the project's `AGENTS.md` points to them.
If they disagree with the examples here, the installed version's docs win.

Notation: **MUST** — never violate; **SHOULD** — yes by default, a deviation
needs a reason.

---

## 1. Decisions before code

Every decision in the table is recorded in the README ("Decisions" section) or
in an ADR, with a reason. Deviating from the default without a recorded reason
is not done.

| Question | Default | When otherwise |
|---|---|---|
| Next.js or SPA | Next.js, if at least one is needed: SSR/SEO, BFF (secrets, HttpOnly cookies), route handlers | An internal app behind a login without SEO or a BFF → Vite + React Router: simpler build and deploy |
| Router | App Router | Pages Router — only in an existing project |
| Monorepo | No, a single app | A second app or package actually appeared → pnpm workspaces; Nx/Turborepo — when builds or CI become slow |
| Multi-Zones, microfrontends | No | Independent teams with independent releases |
| Server data | Server Components for the initial load; TanStack Query for interactive client data and mutations | A purely client app → TanStack Query only |
| Copy and i18n | A translation module from day one (`next-intl` or similar), even for a single locale, if the project follows `fsd-frontend` | An explicit "no i18n" decision is recorded in the README |
| Package manager | pnpm, version in `packageManager` | — |
| Deploy | Decide right away: Vercel, a Node server (`output: "standalone"`) or Docker | Env, caching and CI depend on it |

**MUST:** don't add technology "for the future". A monorepo, a second router,
Storybook, a state manager, MSW "as a backend type" appear when they have a
first real consumer.

---

## 2. Order of steps

1. **Create the project** (`pnpm create next-app@latest`): TypeScript, ESLint,
   Tailwind, App Router. Pin `packageManager`, `engines.node`
   (Next 16 requires Node 20.9+) and `.nvmrc`.
2. **Delete the generator template right away:** the starter page, SVGs in
   `public/`, the template README, demo styles. Replace the README with the
   skeleton from `references/configs.md`. A template left "for later" survives
   until production. **Don't delete the `AGENTS.md` and `CLAUDE.md` from
   `create-next-app`:** the block between `<!-- BEGIN:nextjs-agent-rules -->`
   and `<!-- END:nextjs-agent-rules -->` points agents to the installed
   version's docs, and `next dev` maintains it. Add your project rules outside
   these markers.
3. **Strict TypeScript** (section 4 of `references/configs.md`) and a
   `typecheck` script (`tsc --noEmit`).
4. **FSD structure on top of Next** (section 3 below).
5. **Linting and formatting:** ESLint flat config from `eslint-config-next`
   + type-aware rules + a boundaries linter + Prettier. Next 16 removed `next lint`
   and doesn't lint during `next build` — the linter runs as a separate script and in CI.
6. **Env config** (section 4).
7. **Error model and API client** in `shared/api` (section 5).
8. **Providers** in the `_app` layer: QueryClient, theme, i18n, global
   services (toast, confirm) as a port in `shared` + implementation in `_app`.
9. **UI foundation** (section 6).
10. **Tests:** Vitest + Testing Library + MSW, Playwright for e2e (section 7).
11. **Git hooks:** husky + lint-staged (eslint --fix, prettier) + commitlint.
12. **CI:** lint, typecheck, test, build on every push and PR (section 8).
13. **Secure by default** (section 9).
14. **README** filled with what is already true (section 10), and the
    Definition of Done passed (section 11).

Steps 1–3 are a separate "scaffold" commit: that way history shows what the
generator did and what you did.

---

## 3. FSD on top of Next routing

Following the official FSD guide for the App Router: Next's special `app/`
folder is **at the project root**, the FSD layers are in `src/`, and the `app`
and `pages` layers get a `_` prefix so they aren't confused with Next's
special folders.

```text
app/                         Next routing: route files only
├── layout.tsx               root layout → providers from src/_app
├── (auth)/sign-in/page.tsx  export { SignInPage as default } from "@/_pages/sign-in"
└── api/auth/login/route.ts  route handler (BFF), thin
proxy.ts                     Next 16+ (formerly middleware.ts), next to app/
src/
├── _app/                    app layer: providers, global styles, service implementations
├── _pages/                  pages layer
├── widgets/                 (if the project uses them)
├── features/
├── entities/
└── shared/{ui,api,lib,config}
```

**MUST:**
- Files in `app/` are thin: re-export a page from `src/_pages`,
  `generateMetadata`, parsing `params`/`searchParams` (in Next 15+ they are a
  `Promise` that must be `await`ed) and passing them as props. No logic.
- Route handlers and Server Actions are thin: parse and validate the input →
  call a function from `src` → return a response. Each is a public entry
  point: it checks authorization itself rather than relying on `proxy.ts`.
- Don't create `src/app` and `src/pages`: Next looks for special folders both
  at the root and in `src`, and a folder with that name easily becomes a
  second router.
- The boundaries linter knows about the prefixes: patterns `src/_app`,
  `src/_pages/*` instead of `src/app`, `src/pages/*` (config — `fsd-frontend`,
  `references/conventions.md`, section 11).
- `"use client"` goes as low in the tree as possible. A page is a server
  component by default; client components are interactive leaves.
- Modules with secrets start with `import "server-only"`, modules using
  `window` — with `import "client-only"`.

Details with code: `references/next-structure.md`.

---

## 4. Environment configuration

**MUST:**
- Variables are read in two modules: `shared/config/env.server.ts`
  (`import "server-only"`) and `shared/config/env.client.ts`. The schema is
  `zod`, validated on import: a config error fails at startup, not on the
  first request. `process.env` is forbidden elsewhere (a linter rule).
- `NEXT_PUBLIC_*` are inlined into the bundle **at build time** and only on
  direct access `process.env.NEXT_PUBLIC_X`: no destructuring and no
  `process.env[name]`. You can't build one image for several environments with
  different public values this way — such values are read on the server and
  passed down.
- Secrets — only without the `NEXT_PUBLIC_` prefix.
- `.env.example` contains every variable with a comment and a safe value;
  `.env*` is in `.gitignore`, except `.env.example`. The CI build runs on the
  values from `.env.example`.

---

## 5. Error model and API client

**MUST:**
- Errors are normalized into an `AppError` with `kind` once, at the
  `shared/api` boundary (model — `fsd-frontend`, `references/conventions.md`,
  section 1). Nothing above `shared/api` inspects `Response`, statuses or
  error texts.
- A single `request()` over `fetch` (or a generated client wrapped the same
  way): forwards `signal`, turns a network error into `network`, an HTTP
  status into a `kind`, validates the response body with a schema. Example —
  `references/next-structure.md`.
- The error kind is determined by code: status, `extensions.code` (GraphQL
  responds with 200 to errors too), `code` in the body. If the backend returns
  only text, match on text in a single mapper, with a comment explaining why
  and tests.
- The backend response is mapped to a domain type at the boundary; DTOs don't
  reach the UI.
- User data is not cached across users: no `"use cache"`/`unstable_cache` for
  session-dependent responses.
- The client is generated from a schema (OpenAPI, GraphQL) if one exists. The
  schema or the generated code lives in the repository: CI must not hit a live
  backend.

**SHOULD:** an interface over the transport (`AuthApi` + factory) only when it
already has a second consumer (`fsd-frontend`,
`references/state-and-data.md`, 2.1). Don't add a config value like
`type: "mock"` that throws "not implemented".

---

## 6. UI foundation

- **Design tokens** are CSS variables in `:root` (and for the dark theme),
  connected to Tailwind v4 via `@theme`. Components use tokens only; raw HEX
  and arbitrary values (`text-[#3a3a3a]`) are a one-off exception with a
  comment.
- **Classes exist.** Components copied from shadcn/ui and examples come with
  their own tokens (`bg-card`, `text-muted-foreground`). Either add those
  tokens or replace the classes — otherwise the component silently ends up
  unstyled.
- `shared/ui` primitives are built on a headless library (Radix, React Aria)
  for accessibility; variants — `cva`, class joining — `cn` (`clsx` +
  `tailwind-merge`).
- Fonts — `next/font`, images — `next/image` with dimensions,
  `images.remotePatterns` listed explicitly.
- Storybook — when the UI kit is reused by several apps or teams, not earlier.

---

## 7. Tests

- **Vitest + Testing Library + jsdom + MSW** with
  `onUnhandledFrame: "error"` (MSW 3; in MSW 2 — `onUnhandledRequest`). Config —
  `references/configs.md`.
- Vitest can't render `async` Server Components. Extract their logic into
  functions and unit-test those; test the page itself with e2e.
- **Playwright** for 3–10 critical paths. In CI, e2e runs against a
  predictable backend (a mock server, a staging environment with a test DB),
  not a shared environment where tests change other people's data.
- The first test is written on day zero: it verifies that the test
  infrastructure works and sets an example.

---

## 8. CI

**MUST:** on every push to the main branch and every PR: `lint`,
`typecheck`, `test`, `build`. GitHub Actions template — `references/configs.md`.
Actions is free for public repositories; private ones have a monthly minutes
quota.

- The CI build uses `.env.example`, without secrets.
- e2e is a separate job once there is an isolated backend; until then, an
  explicit note in the README on why they aren't in CI.
- The CI badge appears in the README together with the workflow.

---

## 9. Secure by default

- `poweredByHeader: false`; headers via `headers()` in `next.config.ts`:
  `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (or
  `frame-ancestors` in CSP). A nonce-based CSP is a separate task, but the
  decision "yes / no and why" is recorded right away.
- Server Actions and route handlers are public endpoints: input validation
  with a schema and a permission check in each one.
- `dangerouslySetInnerHTML` — only with a sanitizer and a comment explaining why.
- Personal data and tokens are not logged.
- Authentication — per `frontend-auth-session`.

---

## 10. README

Skeleton — `references/configs.md`. There is one rule: **the README contains
only what is true for the code in this commit.** Each section is updated in
the same commit as the code it describes. Plans go into a separate "Next"
section, marked as not done.

---

## 11. Definition of Done for the start

- [ ] The generator template is removed; the README is a skeleton filled with facts.
- [ ] `packageManager`, `engines.node`, `.nvmrc` are pinned.
- [ ] TS strict; `typecheck`, `lint`, `test`, `build` pass locally (actually run, not assumed).
- [ ] FSD layout with `_app`/`_pages` prefixes; the boundaries linter catches upward imports.
- [ ] Env via two modules with a schema; `process.env` outside them is forbidden by the linter; `.env.example` is complete.
- [ ] `AppError` and `request()` in `shared/api`, covered by tests (network, statuses, invalid schema).
- [ ] Providers in `_app`; the QueryClient is not shared across users on the server.
- [ ] Design tokens in CSS variables; every class used exists.
- [ ] Vitest + MSW + Playwright configured, one live test each.
- [ ] Git hooks and commitlint work.
- [ ] CI is green.
- [ ] Security headers and `poweredByHeader: false`.
- [ ] Decisions from section 1 are recorded.

---

## 12. When in doubt

- Between "add now" and "add when needed" — when needed.
- Between "configure manually" and "leave it as create-next-app generated it" —
  leave it until there is a reason to change, and record the reason when you do.
- Between "a single app" and "a monorepo" — a single app.
- Between "config from memory" and "config from the current version's docs" —
  from the docs.
