# Frontend starter

A Next.js 16 frontend project template with a foundation and an agent layer. A copy of this
folder is a project where the linter with FSD boundaries, types, tests, e2e and CI already
work, and the agent knows the project rules and the feature process from the first session.

Built and verified on 2026-10-22: Next 16.4.2, React 19.3, TypeScript 5.9, ESLint 9,
Vitest 5, MSW 3, Playwright 1.64, Tailwind 4.3, pnpm 10, Node 22.

## New project

From the GitHub template (the repository is marked as a template):

```bash
gh repo create <project> --template rbikbov/frontend-starter --private --clone
cd <project>
pnpm install             # also installs git hooks: the repository already exists
cp .env.example .env.local
pnpm dev
```

Without GitHub — by copying the folder:

```bash
rsync -a --exclude node_modules --exclude .next --exclude test-results \
  --exclude playwright-report --exclude .env.local --exclude .git \
  ~/pet/frontend-starter/ ~/pet/<project>/
cd ~/pet/<project>
git init                 # before pnpm install: husky installs hooks only into a git repository
pnpm install
cp .env.example .env.local
pnpm dev
```

Then:

1. Name: `name` in `package.json`, the heading of `AGENTS.md`, `metadata` in `app/layout.tsx`.
2. `docs/adr/0001-foundation.md`: date, author, and go through the decision table — check
   that the decisions fit the product.
3. Remove skills you don't need from `.claude/skills/` (what can be removed is in
   `.claude/skills/README.md`).
4. Replace the home page (`src/_pages/home`) with the first feature — using the process below.
5. Commit: `git add -A && git commit -m "chore: set up project from frontend-starter"`.

## What's inside

| Part             | What's done                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure        | Routes in the root `app/`, FSD layers in `src/` (`_app`, `_pages`, `shared`; other layers appear with the first slice)                                                        |
| Layer boundaries | `eslint-plugin-boundaries`: imports only go down, into another slice only through `index.ts`. Verified against deliberate violations                                          |
| Network & errors | `request()` with a zod schema, `AppError` with `kind` (network, abort, statuses, Retry-After, response breaking the contract), retries only for network and 5xx. 18 tests     |
| Environment      | `clientEnv` with a zod schema, `process.env` outside `shared/config` is forbidden by the linter                                                                               |
| UI               | Tailwind v4, tokens in CSS variables (names as in shadcn/ui, light and dark themes), `Button` with `type="button"` by default                                                 |
| Error pages      | `error.tsx` with `retry()`, `global-error.tsx`, `not-found.tsx`                                                                                                               |
| Monitoring       | Logger port in `shared/lib`, implementation in `_app`: JSON logs in production, context made of primitives only                                                               |
| Security         | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, no `X-Powered-By`                                                                                             |
| `/api/health`    | Liveness check for deployment, not prerendered and not cached                                                                                                                 |
| Tests            | Vitest + Testing Library + MSW (an unmocked request fails the test); Playwright against the production build: home page with no console errors, 404, health, security headers |
| Quality          | husky + lint-staged + commitlint (Conventional Commits), Prettier with class sorting                                                                                          |
| CI               | GitHub Actions: lint, format, types, tests, build; e2e in a separate job                                                                                                      |

## Scripts

| Command       | What it does                                                    |
| ------------- | --------------------------------------------------------------- |
| `pnpm dev`    | Dev server on :3000                                             |
| `pnpm check`  | Linter, types (`next typegen && tsc`), unit and component tests |
| `pnpm e2e`    | Builds production, serves it on :3100, runs Playwright          |
| `pnpm format` | Prettier                                                        |
| `pnpm build`  | Production build                                                |

Before the first `pnpm e2e` on a machine: `pnpm exec playwright install chromium`.

## Agent layer

| File                                                                    | Why                                                                                                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` (+ `CLAUDE.md`, which imports it)                           | Read at the start of every session: commands, map, 9 rules, process. Short on purpose — only what is always needed                      |
| `app/`, `src/shared/api/`, `src/shared/config/` — their own `AGENTS.md` | Domain rules, loaded when the agent works in that folder                                                                                |
| `.claude/skills/`                                                       | `fsd-frontend`, `feature-workflow`, `anti-slop-review`, `frontend-auth-session`, `adr-writer`, `frontend-bootstrap`                     |
| `.claude/agents/reviewer.md`                                            | Subagent for independent review: clean context, diff, criteria from the PRD                                                             |
| `docs/features/_template/`                                              | PRD, spec, tasks — feature state lives in files, not in the chat                                                                        |
| `docs/adr/`                                                             | ADR template and ADR-0001 with the template's decisions                                                                                 |
| Next.js block in `AGENTS.md`                                            | Added and updated by `next dev`: points the agent to the docs of the installed version in `node_modules/next/dist/docs/`. Do not remove |

Feature process (`feature-workflow`): PRD with Non-Goals → spec up to 150 lines → tasks,
one per commit → read-only research → tracer bullet → test first for logic → review by a
subagent → check in the browser. Three failed attempts in a row — stop and ask a human.

## Third-party skills

Not included in the template: their authors keep them up to date. They are instructions the
agent executes — read them before installing, like any dependency, and don't install two
skills on the same topic.

| Skill                                                                                                                                 | Why                                                                   | Installation                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `next-dev-loop` ([Next.js](https://nextjs.org/blog/next-16-3-ai-improvements))                                                        | The agent checks changes in the browser: console, network, React tree | `npm i -g agent-browser@^0.27`, then `npx skills add vercel/next.js --skill next-dev-loop` |
| `react-best-practices` ([vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills))                                      | React and Next performance: request waterfalls, bundle size           | `npx skills add vercel-labs/agent-skills`, pick this skill                                 |
| `performance`, `core-web-vitals`, `accessibility` ([addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills)) | Web Vitals based on measurements, accessibility per WCAG 2.2          | `npx skills add addyosmani/web-quality-skills`, pick the ones you need                     |
| Sentry ([getsentry/sentry-for-ai](https://github.com/getsentry/sentry-for-ai))                                                        | Setting up Sentry when it's time for monitoring                       | See the repository README                                                                  |

What was verified: the repositories exist and belong to the authors in the table; the Vercel
and Osmani ones are MIT-licensed. The skill contents were not reviewed before installation.

## Updating dependencies

- Next: `npx @next/codemod@canary upgrade latest`, then read the release notes.
- Everything else: `pnpm up --latest`, one major at a time.
- After any update: `pnpm check && pnpm e2e`. Major versions here have already changed APIs
  without errors at install time: MSW 3 renamed the option for unmocked requests (the old
  name is silently ignored), and `eslint-plugin-boundaries` 7 changed the rule format.
