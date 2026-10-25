---
name: feature-workflow
description: >
  Feature development process with an agent: PRD with Non-Goals → compact
  spec → tasks, one per commit → read-only research → tracer bullet →
  build with tests first → independent review by a subagent → check in the
  browser. Use when asked to build a feature, a screen, a user scenario or a
  noticeable behavior change; when you need to write a PRD or a spec, or break
  work into tasks; when the work is bigger than one commit. Do not use for
  typos and one-line fixes.
---

# Feature process

Core principle: **the fewer decisions the agent makes on its own, the more
stable the result.** Every phase ends with an artifact in
`docs/features/<slug>/` and a check (a "gate"). Where marked, moving on
requires a human's confirmation.

How to write the code itself — `fsd-frontend`; junk check — `anti-slop-review`;
sign-in and session — `frontend-auth-session`.

---

## 1. Phases

| # | Phase | Artifact | Approved by | Gate |
|---|---|---|---|---|
| 0 | Preparation | branch | — | Clean working tree; `/clear` after installing dependencies and running migrations |
| 1 | PRD | `prd.md` | human | Non-Goals filled in; criteria are testable; no technical decisions |
| 2 | Spec | `spec.md`, up to 150 lines | human | Covers every PRD criterion and nothing beyond |
| 3 | Tasks | `tasks.md` | human | One task — one commit; the first one is a tracer bullet |
| 4 | Research | log in `tasks.md` | — | Read-only; found what to reuse |
| 5 | Tracer bullet | commit | — | One scenario works end to end and is visible in the browser |
| 6 | Build | a commit per task | — | Test first for logic; `pnpm check` is green |
| 7 | Review | `reviewer` report | human, on findings | Confirmed findings are fixed |
| 8 | Browser | e2e for the critical path | — | PRD scenarios pass with no console errors |

A small task (one commit, no new user-facing behavior) skips phases 1–3, but
Non-Goals are still written into the task description. Skipping a phase is
stated out loud, never done silently.

---

## 2. PRD

Template — `docs/features/_template/prd.md`.

- The agent drafts it from the request and asks only what blocks progress.
  Everything else becomes assumptions under "Open questions", which the human
  confirms during approval.
- **Non-Goals are required.** List what the agent will be tempted to do
  "while at it": responsive layouts for new sizes, animations, i18n, caching,
  an admin panel, refactoring nearby code. Without this list the feature grows.
- Acceptance criteria are testable: "Given / When / Then", not "convenient" or
  "fast".
- No libraries, files or schemas: this is about "what and why", not "how".

## 3. Spec

Template — `docs/features/_template/spec.md`.

- Up to 150 lines. Written by the agent, approved by a human. A long generated
  spec is worse than none: it clogs the context and blurs the decisions.
- Before writing, do a short read-only survey of the affected layers: what
  already exists, what to reuse.
- Contains: where the code lives (layers, slices), data contracts (zod schemas,
  DTO mapping), API (input, output, errors → `kind`), UI states, edge cases,
  acceptance scenarios with the test level.
- **The spec lives with the code.** If behavior changes, `spec.md` is updated
  in the same commit. Code that diverges from the spec is a defect in one of
  the two.

## 4. Tasks

Template — `docs/features/_template/tasks.md`.

- One task — one commit, after which the project builds and the checks pass.
  If the agent hits a dead end, rolling back to the previous commit is cheaper
  than arguing with the model.
- A task fits into one session; each has a "done when".
- The first task is a tracer bullet; then states, edge cases, polish.

## 5. Research (read-only)

Before each task, without editing files:
- `AGENTS.md` of the affected folders;
- existing code that solves something similar (`rg` by names and contracts);
- contracts and types the task relies on.

If the findings will be needed later, add 2–3 lines to the `tasks.md` log.

## 6. Tracer bullet

One scenario end to end: route → page → feature or entity →
`request()` → route handler or backend → result on screen.

- This is production code, not a prototype: correct layers, real contracts
  from the spec.
- Deliberately without: detailed validation, polished loading and error
  states, styles, edge cases.
- Backend not ready — an MSW handler or a route handler serving data per the
  spec's contract; note this in `tasks.md`.
- Check it in the browser: the scenario works and the console has no errors.

## 7. Build

- **Logic — test first:** pure functions, stores, response mapping, hooks with
  branching. The test must fail for the expected reason, then write the code.
  A test written after the code tends to check what the code does rather than
  what is required.
- **Markup and styles — no test up front:** the browser checks them (phase 8),
  and the critical path is covered by e2e.
- After a task: `pnpm check`, commit (lint-staged checks the changed files).
- **Stop:** three failed attempts to fix the same thing — stop. Tell the
  human what you tried and what your hypothesis is. Don't tailor tests to the
  code, don't disable linter rules, don't weaken types.
- Anything outside the task goes into the "later" log, not into this commit.

## 8. Review

- The `reviewer` subagent (`.claude/agents/reviewer.md`) with a clean context:
  pass the path to `prd.md` and `spec.md` and the commit range; it reads the
  diff itself. The author sees their own mistakes worse: their context holds
  the arguments for why the solution is right.
- Confirmed findings are fixed; disputed ones are decided by the human.
- **A human also reviews security:** sign-in, sessions, redirects, cookies,
  user input in HTML. Green checks don't guarantee it: in practice an open
  redirect passed the tests, and an unreadable error page passed the linter.

## 9. Browser

- Next.js: the `next-dev-loop` skill with `agent-browser` if installed;
  otherwise Playwright or the Chrome DevTools MCP.
- Walk through the PRD scenarios, including negative ones: empty data, network
  error, resubmission. Watch the console and request statuses.
- For UI — light and dark themes, phone width.
- The critical path gets an e2e test in `e2e/`.
- **Done** when every PRD criterion is verified; the final message lists the
  criteria and how each was verified.

---

## 10. Context

- Work state lives in `docs/features/<slug>/`, not in the chat: start a new
  session by reading `prd.md`, `spec.md`, `tasks.md`.
- After noisy steps (installs, migrations, long logs) — `/clear`.
- Parallel experiments go into a `git worktree`, not the working branch.

## 11. What not to do

- Endless clarifying questions: ask what blocks you, record the rest as
  assumptions in the PRD.
- Orchestrators of many agents: an executor and a reviewer are enough.
- Specs and documentation nobody approved or reads.
- Silently skipping phases and "fixed it while I was there".
