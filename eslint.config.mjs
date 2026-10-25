import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import boundaries from "eslint-plugin-boundaries";

// FSD layers from bottom to top. The root app/ holds Next routes and sits above all layers.
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
    // Rules that need types: forgotten await, async in handlers, non-exhaustive switch
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
    // Environment variables are read only in shared/config
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    ignores: ["src/shared/config/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Read variables through @/shared/config" },
      ],
    },
  },
  {
    // FSD boundaries: imports only go down, no cross-imports, from outside a slice only through index.ts
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
            "{{from.element.type}} cannot import {{to.element.type}}: only lower layers, into another slice only through index.ts",
          policies: [
            { allow: { to: { module: { origin: { anyOf: ["external", "core"] } } } } },
            { allow: { dependency: { relationship: { to: "internal" } } } },
            ...Object.entries(layersBelow).map(([from, to]) => ({
              from: { element: { type: from } },
              allow: {
                to: [
                  { element: { types: { anyOf: to.filter((t) => !SLICED_LAYERS.includes(t)) } } },
                  // into another slice only through its public API
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
