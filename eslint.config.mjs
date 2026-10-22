import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import boundaries from "eslint-plugin-boundaries";

// Слои FSD снизу вверх. Корневой app/ — маршруты Next, он стоит над всеми слоями.
const SLICED_LAYERS = ["pages", "widgets", "features", "entities"];
const layersBelow = {
  routes: ["app", "pages", "shared"],
  app: [...SLICED_LAYERS, "shared"],
  pages: ["widgets", "features", "entities", "shared"],
  widgets: ["features", "entities", "shared"],
  features: ["entities", "shared"],
  entities: ["shared"],
  shared: ["shared"],
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Правила, которым нужны типы: забытый await, async в обработчиках, неполный switch
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Переменные окружения читаются только в shared/config
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    ignores: ["src/shared/config/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Читай переменные через @/shared/config" },
      ],
    },
  },
  {
    // Границы FSD: импорт только вниз, без cross-import, снаружи слайса — только через index.ts
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/legacy-templates": false,
      "import/resolver": { typescript: { alwaysTryTypes: true } },
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
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          message:
            "{{from.element.type}} не может импортировать {{to.element.type}}: только слои ниже, в чужой слайс — через index.ts",
          policies: [
            { allow: { to: { module: { origin: { anyOf: ["external", "core"] } } } } },
            { allow: { dependency: { relationship: { to: "internal" } } } },
            ...Object.entries(layersBelow).map(([from, to]) => ({
              from: { element: { type: from } },
              allow: {
                to: [
                  { element: { types: { anyOf: to.filter((t) => !SLICED_LAYERS.includes(t)) } } },
                  // в чужой слайс — только через его public API
                  {
                    element: {
                      types: { anyOf: to.filter((t) => SLICED_LAYERS.includes(t)) },
                      fileInternalPath: "index.{ts,tsx}",
                    },
                  },
                ],
              },
            })),
          ],
        },
      ],
    },
  },
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    ".claude/**",
  ]),
]);
