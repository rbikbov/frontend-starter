# Frontend starter

Next.js 16 (App Router) + TypeScript + Feature-Sliced Design. This file is read at the start
of every session, so it holds only what is always needed. Details live in folder-level
`AGENTS.md` files (loaded when you work in that folder) and in the skills in `.claude/skills/`.

## Commands

| What                  | Command                                                  |
| --------------------- | -------------------------------------------------------- |
| Development           | `pnpm dev`                                               |
| Check before a commit | `pnpm check` — lint, typecheck, unit and component tests |
| e2e                   | `pnpm e2e` — builds production and serves it on :3100    |
| Formatting            | `pnpm format`                                            |

Do not claim checks pass until you have run them. In test and linter output, read the
errors, not the whole log.

## Map

```text
app/                  Next routes: thin files → src/_pages. Rules: app/AGENTS.md
src/_app/             providers, design tokens (styles/globals.css), logger implementation
src/_pages/           pages (the pages layer)
src/widgets|features|entities/   appear with the first slice, never created empty
src/shared/api/       request(), AppError, QueryClient. Rules: src/shared/api/AGENTS.md
src/shared/config/    environment variables. Rules: src/shared/config/AGENTS.md
src/shared/lib|ui/    utilities, logger, UI primitives
docs/adr/             architecture decisions;  docs/features/  PRDs, specs, tasks
e2e/                  Playwright
```

## Rules that always apply

1. Imports go only down the layers; into another slice only through its `index.ts`. The
   linter checks this; do not work around it or disable rules.
2. Above `shared/api`, errors are only `AppError` with a `kind`. The kind of error comes
   from a code or status, not from the message text.
3. Network data goes through `request()` with a zod schema; the response is mapped to a
   domain type at the API boundary.
4. `process.env` only in `src/shared/config`.
5. No personal data or tokens in logs. Session tokens are not accessible to JS.
6. Styles use only tokens from `src/_app/styles/globals.css`. A class missing from `@theme`
   is silently not applied — add a token or use an existing one.
7. Every async action in the UI has loading, error and empty states and blocks repeated
   submission.
8. Nothing "for the future": no layers, config options or abstractions without a consumer.
9. Facts about Next.js come from `node_modules/next/dist/docs/` (block below), not from memory.

## How to work

- A feature or a noticeable behavior change — the `feature-workflow` skill: PRD with
  Non-Goals → spec up to 150 lines → tasks, one per commit → tracer bullet → test first for
  logic → review by the `reviewer` subagent → check in the browser.
- Three failed attempts to fix the same thing — stop and describe the problem to a human.
- Decisions needed in later sessions go into `docs/`, not into the chat.
- A deviation from a rule needs a reason in the code or in an ADR.

## Skills

`fsd-frontend` — how to write code · `feature-workflow` — feature process ·
`anti-slop-review` — check before a commit or publishing · `frontend-auth-session` —
sign-in and session · `adr-writer` — ADRs · `frontend-bootstrap` — foundation decisions and audit.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
