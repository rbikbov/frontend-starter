# Frontend skills

A set for running a Next.js + TypeScript frontend project.
The skills are independent: you can delete one and the rest keep working.
Links between them are soft ("if the project has skill X"), so without the
target the agent simply skips the reference.

| Skill | When it triggers | Refers to |
|---|---|---|
| `fsd-frontend` | Writing or reviewing code: FSD layers, DI, state, errors, tests | — |
| `frontend-bootstrap` | Creating a project or laying the foundation: Next + FSD structure, configs, env, API client, CI | `fsd-frontend`, `frontend-auth-session`, `anti-slop-review` |
| `frontend-auth-session` | Sign-in, sign-up, password recovery, protected pages, token refresh | `fsd-frontend`, `frontend-bootstrap` |
| `anti-slop-review` | Before a commit, PR or publishing; reviewing AI-assisted code | — |
| `feature-workflow` | A feature or a noticeable behavior change: PRD → spec → tasks → tracer bullet → test first → review → browser | `fsd-frontend`, `anti-slop-review`, `frontend-auth-session` |
| `adr-writer` | Recording an architecture decision | — |

## What to delete

- No authentication → `frontend-auth-session`.
- The project is already on its feet → `frontend-bootstrap` is no longer
  needed for daily work, but is useful as an audit checklist.
- Not Next.js → `frontend-bootstrap` and `frontend-auth-session` are written
  for it; `fsd-frontend` and `anti-slop-review` don't depend on the framework.
- No ADRs → `adr-writer`.

## Source

`adr-writer` is taken from
[kfreiman/engineer-challenge](https://github.com/kfreiman/engineer-challenge/blob/master/.agents/skills/adr-writer/SKILL.md)
unchanged.
