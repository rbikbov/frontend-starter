---
name: frontend-auth-session
description: >
  Authentication and session in a Next.js (App Router) frontend: where to store
  tokens, a BFF on route handlers with HttpOnly cookies, race-free token
  refresh, detecting "unauthenticated" (including GraphQL, which responds with
  200), checks in proxy.ts and the Data Access Layer, safe redirect after
  sign-in, sign-out without leaking the previous user's data, tokens in
  password reset links, sign-in and recovery forms. Use when designing or
  writing sign-in, sign-up, password recovery, protected pages, an API client
  with a refresh token, or when reviewing such code.
---

# Authentication and session in Next.js

This document covers a frontend that receives a session from the backend
(tokens or a session id) and has to store it, extend it and check it. If the
project uses a library or provider (Auth.js, Better Auth, Clerk, etc.), it
handles the session mechanics, but the rules in sections 2 and 6–10 still apply.
Code — `references/implementation.md`.

**Rule priority.** The user's instructions and the project's agent files take
precedence. If the backend dictates otherwise (for example, it sets the cookies
itself), follow the backend and record the difference in the README or an ADR.

Notation: **MUST** — never violate; **SHOULD** — yes by default, a deviation
needs a reason.

---

## 1. Choosing a model

| Model | When |
|---|---|
| **BFF:** Next route handlers receive tokens from the backend and put them into HttpOnly cookies | The backend returns tokens in the response body. The default for Next |
| The backend sets HttpOnly cookies itself | Frontend and API on the same site, backend under your control |
| A library or provider | You need OAuth, MFA, user management — don't write this yourself |
| Access token in memory, refresh token in an HttpOnly cookie | SPA without a BFF |
| Tokens in `localStorage`/`sessionStorage` | **Forbidden:** any XSS steals the session |

The second fork is **what the BFF proxies**:

| Option | Pros | Cons |
|---|---|---|
| Only login / refresh / logout; other requests go to the API directly with cookies | The BFF is not a bottleneck; less code | The API reads the token from a cookie and configures CORS; cookies must reach the API domain |
| All requests through the BFF | The API knows nothing about cookies and CORS; one origin | Every request is an extra hop; the BFF has to scale |

The choice is recorded in an ADR.

---

## 2. Cookies (MUST)

- `HttpOnly` for everything that grants access (access, refresh, session id).
- `Secure` in production. Locally, browsers allow `Secure` on
  `http://localhost`, but not on other http hosts.
- `SameSite=Lax` by default. `Strict` is stronger against CSRF, but a user
  arriving via a link from an email or another site looks unauthenticated on
  the first navigation — choose deliberately and record the reason.
- `Path=/`; lifetime comes from the token's `exp` or from the backend response,
  not a guess.
- SHOULD: the `__Host-` name prefix (requires `Secure`, `Path=/`, no
  `Domain`) — the cookie can't be overridden from a subdomain.
- Cookies are set and deleted **only on the server** (route handler, Server
  Action, `proxy.ts`). Server Components can't set cookies.
- A cookie unreadable from JS is the only carrier of the session. A flag like
  `is_authenticated` without `HttpOnly` is acceptable only as a UI hint and is
  never used for access decisions.

---

## 3. BFF: route handlers (MUST)

- Input is validated with a schema (`zod`); a malformed body gets `400`.
- Mutating handlers check `Origin` against the app's origin: `SameSite=Lax`
  doesn't protect against requests from subdomains of the same site.
  Server Actions compare `Origin` with `Host` themselves.
- Client context is forwarded to the backend: `X-Forwarded-For`,
  `User-Agent` — otherwise the backend's rate limit only sees the server's IP.
- Backend errors are translated into a response with `kind` and status (`401`,
  `403`, `422`, `429` with `Retry-After`, `503`); the backend's text doesn't
  leak out.
- **Refresh:** if the backend **rejected** the refresh token, delete the
  cookies and respond `401`. If the backend is **unavailable** (network, 5xx),
  leave the cookies alone and respond `503`: a transient failure must not sign
  the user out.
- **Logout:** revoke the token on the backend (log the error but don't show
  it), and delete the cookies regardless.

---

## 4. Where to check the session (MUST)

| Place | What it does | What it doesn't do |
|---|---|---|
| `proxy.ts` (Next 16+, formerly `middleware.ts`) | Optimistic check by cookie presence: redirect to sign-in and away from sign-in pages | Doesn't hit the DB or API; is not the only protection |
| Data Access Layer (`verifySession()` in a `server-only` module) | Check next to the data: in server components, route handlers, Server Actions | — |
| Layout | Nothing: layouts don't re-render on navigation | Doesn't check access |
| Backend | Source of truth: verifies the token on every request | — |

- Every route handler and Server Action is a public entry point and calls
  `verifySession()` itself.
- `proxy.ts` checks the **refresh** cookie (or session id): the access token
  may have expired while the session is alive.
- Path matching is by segment: `/app` and `/app/…`, but not `/apple`.
- With `cacheComponents` (the default in Next 16.4 projects), reading the
  session and caching user data have their own rules: before writing the DAL,
  read `node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md`.
- Permissions (role, ownership) are decided from verified data: by signature
  (JWKS, `jose`) or by the backend's response. An unverified JWT payload is no
  basis for access.
- Server Components can't update cookies. If the access token expired by the
  time of server rendering: either `proxy.ts` refreshes the session (it can set
  cookies on the response — do this only for document navigations, not
  prefetches, and account for refresh token rotation), or the page renders a
  client-side loading state and the client does the refresh.

---

## 5. Client: race-free refresh (MUST)

- **Detecting "unauthenticated":** HTTP `401`, or in a GraphQL response (which
  is `200`) at least one error with `extensions.code === "UNAUTHENTICATED"`
  (`errors.some`, not `errors[0]`). Comparing message text only if the backend
  provides no codes, in one function, with a comment and a test.
- **Single-flight:** parallel requests that got 401 wait for one shared
  refresh and **use its result**. The promise is reset in `finally`.
- The original request is retried **once**. A second 401 means the session is
  lost, no second refresh.
- The refresh request itself doesn't go through the interceptor (otherwise
  recursion).
- The refresh result distinguishes three outcomes: issued (`true`) → retry;
  rejected (`false`) → session expired; network or 5xx (exception) → a
  `network` error, **without** signing out.
- Refresh is blocked during sign-out: otherwise a request that failed with 401
  at the moment of logout would immediately restore the session.
- Expired session: clear the query cache, send the user to sign-in with a
  `callbackUrl` of the current page.
- The body of a retried request must be replayable (a string, `FormData`), not
  a one-shot `ReadableStream`.

---

## 6. Redirect after sign-in (MUST)

- `callbackUrl` (`next`, `returnTo`) is validated by
  `getSafeRedirect(raw, fallback, appOrigin)`: it rejects `\` and control
  characters (browsers turn `/\evil.com` and `/<tab>/evil.com` into
  `//evil.com`), parses `new URL(raw, appOrigin)`, compares the origin and
  returns only the path. Checking "starts with `/` and not with `//`" is
  **not enough**.
- Its test suite — `references/implementation.md`, section 7.
- After sign-in, server components must see the new cookies: a full navigation
  (`window.location.assign`) or `router.replace` + `router.refresh()`.

---

## 7. Sign-out (MUST)

- The server deletes the cookies (section 3).
- The client clears the query cache (`queryClient.clear()`) and all client
  stores with user data: the next user in the same tab must not see someone
  else's data, even for an instant.
- Navigate to the sign-in page with no way to go "back" to a cached protected
  screen (`replace` or a full navigation).
- Confirming sign-out is up to the product; disabling the button while the
  request is in flight is required.
- SHOULD: other tabs learn about the sign-out (`BroadcastChannel` or a
  `storage` event on a flag), otherwise they keep showing data until the first 401.

---

## 8. Tokens in links (password reset, email confirmation)

- The token is read from the URL **once** into state, then the address is
  replaced without the token (`router.replace(pathname)`): it doesn't stay in
  history and doesn't leak via `Referer`.
- For these pages — `Referrer-Policy: no-referrer` and no third-party scripts
  (analytics, widgets).
- The token is not logged. One-time use and lifetime are enforced by the
  backend; the frontend shows a clear "link expired" screen with a "request a
  new one" action.

---

## 9. Sign-in and recovery forms

- Password recovery responds the same way for existing and nonexistent emails
  ("if an account exists, an email has been sent"), without revealing who is
  registered. If the backend reveals it, record that as a limitation.
- Submission is blocked while the request is in flight; resubmitting doesn't
  create a second request.
- `429`: a message with the wait time from `Retry-After`, if present.
- Fields: `type="email"` + `autoComplete="email"`; password —
  `autoComplete="current-password"` for sign-in and `"new-password"` for
  sign-up and change; pasting is not blocked.
- The "show password" button — `type="button"`, `aria-label` and
  `aria-pressed`, doesn't steal focus from the field.
- The "invalid email or password" error doesn't specify which one is wrong.
- Server errors are mapped to fields by code; a general one goes above the form.

---

## 10. Data and logs

- User-dependent responses don't go into shared caches (`"use cache"`, CDN).
  The server-side QueryClient is created fresh for every request.
- No tokens, passwords or emails in logs. At most — the user id and the error
  `kind`.
- The session token payload is minimal: id and role, no personal data.

---

## 11. Tests

- **Unit:** `getSafeRedirect` (the full suite from references); detecting
  "unauthenticated" (401, GraphQL codes, empty body, HTML instead of JSON).
- **Single-flight:** N parallel requests with 401 → one refresh, N retries;
  refresh rejected → no retries, one `onSessionExpired` call; refresh failed
  on the network → a `network` error, no sign-out; a second 401 after a
  successful refresh → no second refresh; during logout → no refresh.
- **Route handlers:** cookie flags; refresh rejected → cookies deleted;
  backend unavailable → cookies kept, `503`; invalid body → `400`; foreign
  `Origin` → `403`.
- **e2e:** sign in → protected page → sign out → protected page is
  unavailable; access expiry (short TTL in the test environment) → transparent
  refresh; password reset link → the token is gone from the address bar.

---

## 12. Definition of Done

- [ ] No token is readable from JS; `localStorage` is not used for the session.
- [ ] Cookies: `HttpOnly`, `Secure` in prod, `SameSite`, `Path`, lifetime from the token.
- [ ] Refresh: rejection and backend unavailability are distinguished.
- [ ] Single-flight with a result, one retry, blocking during logout — covered by tests.
- [ ] `proxy.ts` is only an optimistic check; the DAL is called in handlers, actions and server components.
- [ ] `getSafeRedirect` with the full test suite.
- [ ] Sign-out clears the client's cache and stores.
- [ ] Tokens from links are removed from the address bar.
- [ ] No tokens or personal data in logs.
- [ ] The choice of model and proxying is recorded in an ADR.
