# ADR-0001: Frontend foundation

Status: accepted · Date: <project creation date> · Author: <name>

## Context

The project starts from the `frontend-starter` template. The decisions below are the template
defaults; at project start check whether they fit the product, and rewrite this ADR if not.

## Decisions

| Question     | Decision                                                                                                                                                                           | When to revisit                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Framework    | Next.js 16 (App Router), `cacheComponents` and `partialPrefetching` enabled, as in `create-next-app`                                                                               | No SEO, SSR or BFF — a Vite SPA would do       |
| Architecture | FSD: routes in the root `app/`, layers in `src/` (`_app`, `_pages` — prefixed so they aren't confused with Next's special folders). `eslint-plugin-boundaries` enforces boundaries | —                                              |
| Server data  | `request()` + zod schemas at the boundary, `AppError` with `kind`; TanStack Query for client data                                                                                  | —                                              |
| Styles       | Tailwind v4, tokens as CSS variables named as in shadcn/ui                                                                                                                         | —                                              |
| Tests        | Vitest + Testing Library + MSW; e2e with Playwright against a production build                                                                                                     | —                                              |
| Copy         | Strings in components, no i18n                                                                                                                                                     | A second locale appears — before it, not after |
| Monorepo     | pnpm workspaces: `apps/web` (Next.js) and `apps/api` (NestJS), no task orchestrator                                                                                                | CI builds become slow — Turborepo              |
| Auth         | None; when needed, follow the `frontend-auth-session` skill                                                                                                                        | First protected page                           |
| Monitoring   | Logger port in `shared/lib`, implementation in `_app` (console)                                                                                                                    | First deploy: connect an error service         |

## Alternatives

| Option                                        | Why not chosen                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/app` for routes and an FSD `pages` layer | Next also looks for special `app/` and `pages/` folders in `src`: `src/pages` easily becomes a second router |
| Steiger instead of `eslint-plugin-boundaries` | A separate tool outside ESLint; the `_app`/`_pages` prefixes need extra configuration                        |
| Backend mocks as a "backend type" in config   | Not needed without a second consumer; MSW replaces the network in tests                                      |

## Consequences

- New code is laid out by the rules from the first commit; the linter and CI catch boundary violations.
- Next 16 changes quickly: agents take facts about it from `node_modules/next/dist/docs/`, not from memory.
- Strings without i18n are cheaper now and costlier with a second locale — revisit the decision ahead of time.
