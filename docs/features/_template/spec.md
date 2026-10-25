# Spec: <feature name>

PRD: [prd.md](./prd.md) · Status: draft · Date: YYYY-MM-DD

<!-- Up to 150 lines. Written by the agent, approved by a human. If behavior changes, update it in the same commit. -->

## Context

<One paragraph: what we are building and what existing code we rely on.>

## Where the code lives

| Layer / slice       | What we add or change | What we reuse |
| ------------------- | --------------------- | ------------- |
| `src/_pages/<page>` | …                     | …             |

## Data contracts

```ts
// zod response schemas and DTO → domain type mapping
```

## API

| Method and path | Input | Output | Errors → `kind`   |
| --------------- | ----- | ------ | ----------------- |
| `GET /…`        | …     | …      | 404 → `not-found` |

## UI states

- Loading: …
- Error: … (what the user sees, how to retry)
- Empty: …
- Success: …
- Resubmission: blocked while the request is in flight.

## Edge cases

- …

## Acceptance scenarios

| PRD criterion | Scenario | Test level             |
| ------------- | -------- | ---------------------- |
| …             | …        | unit / component / e2e |

## Risks

- …
