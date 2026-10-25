# Starter configs

Templates for Next.js 16.4, ESLint 9 (flat config), Tailwind v4, Vitest 5,
MSW 3, Playwright, pnpm. All of them are verified live in the
`frontend-starter` template: if it exists, copy the configs from there, not
from here. Before copying, check against the docs of the installed versions;
afterwards, run the script the config serves.

`create-next-app` 16.4 enables `cacheComponents: true` and
`partialPrefetching: true` in `next.config.ts` by default and wires Tailwind
through the Turbopack loader (`@tailwindcss/turbopack`), without PostCSS. Keep
these settings: they determine how pages and handlers are prerendered.

## Contents

1. [package.json](#1-packagejson)
2. [TypeScript](#2-typescript)
3. [ESLint](#3-eslint)
4. [Prettier](#4-prettier)
5. [Git hooks and commitlint](#5-git-hooks-and-commitlint)
6. [Vitest](#6-vitest)
7. [Playwright](#7-playwright)
8. [next.config.ts](#8-nextconfigts)
9. [.gitignore](#9-gitignore)
10. [CI (GitHub Actions)](#10-ci-github-actions)
11. [README skeleton](#11-readme-skeleton)

---

## 1. package.json

```jsonc
{
  "packageManager": "pnpm@<version from `pnpm -v`>",
  "engines": { "node": ">=20.9" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    // next typegen generates route types (PageProps etc.); without it tsc doesn't see them
    "typecheck": "next typegen && tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{js,mjs,ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,css,md,yml,yaml}": ["prettier --write"]
  }
}
```

Next to it — `.nvmrc` with the major Node version CI builds on.

---

## 2. TypeScript

Add to what `create-next-app` generated:

```jsonc
// tsconfig.json (compilerOptions fragment)
{
  "strict": true,
  "noUncheckedIndexedAccess": true,   // arr[i] and record[key] are T | undefined
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "paths": { "@/*": ["./src/*"] }     // FSD lives in src/, routes in the root app/
}
```

`exactOptionalPropertyTypes` is useful but conflicts with some libraries —
enable it deliberately.

---

## 3. ESLint

```js
// eslint.config.mjs
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // type-aware rules: catch missing await, async handlers, non-exhaustive switch
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // env is read only in shared/config
    files: ["src/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    ignores: ["src/shared/config/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Read variables via @/shared/config" },
      ],
    },
  },
  boundariesConfig, // from the block below; declare it above export default
  prettier, // last among the rules: turns off stylistic rules that conflict with Prettier
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);
```

FSD boundaries for `eslint-plugin-boundaries` 7 (in v7 the `element-types` and
`entry-point` rules were replaced by `boundaries/dependencies` with policies; the
config in `fsd-frontend` is written for v5–v6). Verified against deliberate
violations: upward import, cross-import, deep import into another slice,
`process.env` outside the config.

```js
import boundaries from "eslint-plugin-boundaries";

const SLICED_LAYERS = ["pages", "widgets", "features", "entities"];
const layersBelow = {
  routes: ["app", "pages", "shared"], // Next's root app/: only pages, providers, shared
  app: [...SLICED_LAYERS, "shared"],
  pages: ["widgets", "features", "entities", "shared"],
  widgets: ["features", "entities", "shared"],
  features: ["entities", "shared"],
  entities: ["shared"],
  shared: ["shared"],
};

const boundariesConfig = {
  files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
  plugins: { boundaries },
  settings: {
    "boundaries/legacy-templates": false,
    "import/resolver": { typescript: { alwaysTryTypes: true } }, // eslint-import-resolver-typescript
    "boundaries/elements": [
      { type: "routes", pattern: "app" },
      { type: "app", pattern: "src/_app" },
      { type: "pages", pattern: "src/_pages/*", capture: ["slice"] },
      { type: "widgets", pattern: "src/widgets/*", capture: ["slice"] },
      { type: "features", pattern: "src/features/*", capture: ["slice"] },
      { type: "entities", pattern: "src/entities/*", capture: ["slice"] },
      { type: "shared", pattern: "src/shared/*", capture: ["segment"] },
    ],
  },
  rules: {
    "boundaries/dependencies": ["error", {
      default: "disallow",
      message: "{{from.element.type}} cannot import {{to.element.type}}: only lower layers, another slice only via index.ts",
      policies: [
        { allow: { to: { module: { origin: { anyOf: ["external", "core"] } } } } },
        { allow: { dependency: { relationship: { to: "internal" } } } }, // anything within its own slice
        ...Object.entries(layersBelow).map(([from, to]) => ({
          from: { element: { type: from } },
          allow: {
            to: [
              { element: { types: { anyOf: to.filter((t) => !SLICED_LAYERS.includes(t)) } } },
              // another slice — public API only
              { element: { types: { anyOf: to.filter((t) => SLICED_LAYERS.includes(t)) }, fileInternalPath: "index.{ts,tsx}" } },
            ],
          },
        })),
      ],
    }],
  },
};
```

Next 16 doesn't run the linter during `next build` — `pnpm lint` is required in CI.

---

## 4. Prettier

```json
// .prettierrc
{
  "singleQuote": true,
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "./src/_app/styles/globals.css"
}
```

`prettier-plugin-tailwindcss` sorts classes; for Tailwind v4 it needs the path
to the CSS entry (`tailwindStylesheet`). `.prettierignore` holds the same as
`globalIgnores`, plus `pnpm-lock.yaml` and generated code.

---

## 5. Git hooks and commitlint

```bash
pnpm add -D husky lint-staged @commitlint/cli @commitlint/config-conventional
pnpm exec husky init
```

```sh
# .husky/pre-commit
pnpm exec lint-staged
```

```sh
# .husky/commit-msg
pnpm exec commitlint --edit "$1"
```

```js
// commitlint.config.mjs
export default { extends: ["@commitlint/config-conventional"] };
```

Hooks are fast checks of staged files. Full typecheck and tests run in CI;
otherwise committing gets slow and people start bypassing hooks with `--no-verify`.

---

## 6. Vitest

```bash
pnpm add -D vitest @vitejs/plugin-react jsdom \
  @testing-library/react @testing-library/dom @testing-library/user-event \
  @testing-library/jest-dom msw
```

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true }, // Vite understands tsconfig paths itself, no plugin needed
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // values for modules that validate env on import
    env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
  },
});
```

```ts
// vitest.setup.ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "@/shared/lib/test/msw-server"; // export const server = setupServer() from "msw/node"

// server-only throws when imported outside the react-server environment, but modules using it are tested
vi.mock("server-only", () => ({}));

// MSW 3: onUnhandledFrame (in MSW 2 — onUnhandledRequest). The old name is silently ignored,
// and unmocked requests stop failing tests — only tsc catches it.
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
```

Test providers and fakes — `fsd-frontend`, `references/testing.md`.

---

## 7. Playwright

```bash
pnpm create playwright   # tests in e2e/, browsers are installed separately
```

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const PORT = 3100; // not 3000: doesn't clash with an already running dev server

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // against a production build: dev mode behaves differently (error overlay, lazy compilation)
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
```

Other browsers are added when there is a reason (Safari support is a product
requirement), not by default: each one multiplies the run time.

---

## 8. next.config.ts

```ts
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // images: { remotePatterns: [{ protocol: "https", hostname: "cdn.example.com" }] },
};

export default nextConfig;
```

---

## 9. .gitignore

Add to the generated file:

```gitignore
.env*
!.env.example
next-env.d.ts      # generated by next typegen / dev / build
/coverage
/playwright-report
/test-results
```

---

## 10. CI (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  checks:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      NEXT_TELEMETRY_DISABLED: 1
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4 # pnpm version comes from packageManager
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # next typegen and build load next.config and env, using the example values
      - run: cp .env.example .env
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build

  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: cp .env.example .env
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report
          retention-days: 7
```

The `e2e` job works as long as tests don't hit an external backend. Once they
do, you need an isolated backend (a mock server, an environment with a test DB),
not a shared one.

---

## 11. README skeleton

```markdown
# <Name>

<One sentence: what it is and who it's for.>

## Getting started

Requirements: Node <version>, pnpm <version>.

    cp .env.example .env
    pnpm install
    pnpm dev

| Variable | Purpose |
|---|---|
| ... | ... |

## Scripts

`dev`, `build`, `lint`, `typecheck`, `test`, `e2e` — what each does, if not obvious.

## Architecture

Layout (root `app/` — routes, `src/` — FSD layers), where to put new code,
links to ADRs.

## Decisions and trade-offs

Decisions from section 1 of SKILL.md with reasons. Known limitations.

## Tests

What is covered at each level, how to run it, what is deliberately not covered and why.

## Next

What isn't done. Future tense only here.
```

No emoji in headings and no evaluative words ("modern", "powerful",
"production-ready"): the README describes, it doesn't sell.
