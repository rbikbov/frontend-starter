# src/shared/api — network and errors

- `request(url, { schema, ... })` is the only way to the network. The schema is required: a
  response that breaks the contract becomes `AppError("unknown")`, not a silent `undefined`
  in the UI.
- Nothing above this folder reads `Response`, statuses or error texts — only
  `AppError.kind` and `details` (`status`, `fieldErrors`, `retryAfter`).
- The backend error body format is described once — `ErrorBodySchema` in `request.ts`.
  Change it to match the backend contract instead of parsing the error body in features.
- GraphQL responds with 200 on errors too: check the whole `errors` array and derive `kind`
  from `extensions.code`. Match on message text only if there are no codes, in a single
  function, with a comment and a test for every string.
- Retries (`shouldRetry`) only for `network` and 5xx. A retry will not fix a 4xx.
- Requests for specific entities do not go here: the `queryOptions` factory and DTO mapping
  live in `entities/<x>/api` (or in `pages/<page>/api` if only one page needs the entity).
- Tests use MSW: each test declares its own network via `server.use()`, and an unmocked
  request fails the test. A new kind of response means a new test in `request.test.ts`.
