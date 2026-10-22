# Конфиги для старта

Шаблоны под Next.js 16.4, ESLint 9 (flat config), Tailwind v4, Vitest 5,
MSW 3, Playwright, pnpm. Все они проверены вживую в шаблоне
`frontend-starter`: если он есть, копируй конфиги оттуда, а не отсюда. Перед
копированием сверь с документацией установленных версий; после — запусти
скрипт, который конфиг обслуживает.

`create-next-app` 16.4 по умолчанию включает в `next.config.ts`
`cacheComponents: true`, `partialPrefetching: true` и подключает Tailwind
через loader Turbopack (`@tailwindcss/turbopack`), без PostCSS. Эти
настройки оставляй: от них зависит, как пререндерятся страницы и обработчики.

## Содержание

1. [package.json](#1-packagejson)
2. [TypeScript](#2-typescript)
3. [ESLint](#3-eslint)
4. [Prettier](#4-prettier)
5. [Git-хуки и commitlint](#5-git-хуки-и-commitlint)
6. [Vitest](#6-vitest)
7. [Playwright](#7-playwright)
8. [next.config.ts](#8-nextconfigts)
9. [.gitignore](#9-gitignore)
10. [CI (GitHub Actions)](#10-ci-github-actions)
11. [Каркас README](#11-каркас-readme)

---

## 1. package.json

```jsonc
{
  "packageManager": "pnpm@<версия из `pnpm -v`>",
  "engines": { "node": ">=20.9" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    // next typegen генерирует типы маршрутов (PageProps и т. п.), без него tsc их не видит
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

Рядом — `.nvmrc` с мажорной версией Node, на которой собирается CI.

---

## 2. TypeScript

К тому, что сгенерировал `create-next-app`, добавь:

```jsonc
// tsconfig.json (фрагмент compilerOptions)
{
  "strict": true,
  "noUncheckedIndexedAccess": true,   // arr[i] и record[key] — T | undefined
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "paths": { "@/*": ["./src/*"] }     // FSD живёт в src/, маршруты в корневом app/
}
```

`exactOptionalPropertyTypes` полезен, но конфликтует с частью библиотек —
включай осознанно.

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
    // type-aware правила: ловят забытый await, async в обработчиках, неполный switch
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
    // env читается только в shared/config
    files: ["src/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    ignores: ["src/shared/config/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Читай переменные через @/shared/config" },
      ],
    },
  },
  boundariesConfig, // из блока ниже; объяви его выше export default
  prettier, // последним из правил: выключает стилистические правила, конфликтующие с Prettier
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);
```

Границы FSD для `eslint-plugin-boundaries` 7 (в v7 правила `element-types` и
`entry-point` заменены на `boundaries/dependencies` с policies; конфиг из
`fsd-frontend` написан для v5–v6). Проверено на заведомых нарушениях: импорт
вверх, cross-import, глубокий импорт в чужой слайс, `process.env` вне конфига.

```js
import boundaries from "eslint-plugin-boundaries";

const SLICED_LAYERS = ["pages", "widgets", "features", "entities"];
const layersBelow = {
  routes: ["app", "pages", "shared"], // корневой app/ Next: только страницы, провайдеры, shared
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
      message: "{{from.element.type}} не может импортировать {{to.element.type}}: только слои ниже, в чужой слайс — через index.ts",
      policies: [
        { allow: { to: { module: { origin: { anyOf: ["external", "core"] } } } } },
        { allow: { dependency: { relationship: { to: "internal" } } } }, // внутри своего слайса — всё
        ...Object.entries(layersBelow).map(([from, to]) => ({
          from: { element: { type: from } },
          allow: {
            to: [
              { element: { types: { anyOf: to.filter((t) => !SLICED_LAYERS.includes(t)) } } },
              // в чужой слайс — только public API
              { element: { types: { anyOf: to.filter((t) => SLICED_LAYERS.includes(t)) }, fileInternalPath: "index.{ts,tsx}" } },
            ],
          },
        })),
      ],
    }],
  },
};
```

Next 16 не запускает линтер при `next build` — `pnpm lint` обязателен в CI.

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

`prettier-plugin-tailwindcss` сортирует классы; для Tailwind v4 ему нужен
путь к CSS-входу (`tailwindStylesheet`). В `.prettierignore` — то же, что в
`globalIgnores`, плюс `pnpm-lock.yaml` и сгенерированный код.

---

## 5. Git-хуки и commitlint

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

Хуки — быстрые проверки staged-файлов. Typecheck и тесты целиком — в CI,
иначе коммит становится медленным, и хуки начинают обходить `--no-verify`.

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
  resolve: { tsconfigPaths: true }, // Vite понимает paths из tsconfig сам, плагин не нужен
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // значения для модулей, которые валидируют env при импорте
    env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
  },
});
```

```ts
// vitest.setup.ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "@/shared/lib/test/msw-server"; // export const server = setupServer() из "msw/node"

// server-only бросает при импорте вне react-server окружения, а модули с ним тестируются
vi.mock("server-only", () => ({}));

// MSW 3: onUnhandledFrame (в MSW 2 — onUnhandledRequest). Старое имя тихо игнорируется,
// и незамоканные запросы перестают валить тесты — ловит только tsc.
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
```

Тестовые провайдеры и фейки — `fsd-frontend`, `references/testing.md`.

---

## 7. Playwright

```bash
pnpm create playwright   # тесты в e2e/, браузеры ставятся отдельно
```

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const PORT = 3100; // не 3000: не мешает уже запущенному dev-серверу

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // против продакшен-сборки: dev-режим ведёт себя иначе (оверлей ошибок, ленивая компиляция)
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
```

Другие браузеры добавляются, когда есть причина (поддержка Safari —
требование продукта), а не по умолчанию: каждый умножает время прогона.

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

К сгенерированному добавь:

```gitignore
.env*
!.env.example
next-env.d.ts      # генерируется next typegen / dev / build
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
      - uses: pnpm/action-setup@v4 # версия pnpm берётся из packageManager
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # next typegen и build загружают next.config и env — на значениях из примера
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

Job `e2e` годится, пока тесты не ходят во внешний бэкенд. Когда начнут —
нужен изолированный бэкенд (мок-сервер, стенд с тестовой БД), а не общий.

---

## 11. Каркас README

```markdown
# <Название>

<Одна фраза: что это и для кого.>

## Запуск

Требования: Node <версия>, pnpm <версия>.

    cp .env.example .env
    pnpm install
    pnpm dev

| Переменная | Назначение |
|---|---|
| ... | ... |

## Скрипты

`dev`, `build`, `lint`, `typecheck`, `test`, `e2e` — что делает каждый, если неочевидно.

## Архитектура

Раскладка (корневой `app/` — маршруты, `src/` — слои FSD), куда класть новый код,
ссылки на ADR.

## Решения и компромиссы

Решения из раздела 1 SKILL.md с причинами. Известные ограничения.

## Тесты

Что покрыто на каждом уровне, как запустить, что сознательно не покрыто и почему.

## Дальше

Что не сделано. Только здесь — будущее время.
```

Без эмодзи в заголовках и без оценочных слов («современный», «мощный»,
«production-ready»): README описывает, а не продаёт.
