import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const PORT = 3100; // not 3000: doesn't clash with a dev server that may already be running

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  // other browsers — once Safari or Firefox support becomes a product requirement
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // e2e run against the production build: dev mode behaves differently (overlay, lazy compilation)
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
