import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { server } from "@/shared/lib/test/msw-server";

// server-only бросает при импорте вне react-server окружения, а модули с ним тоже тестируются
vi.mock("server-only", () => ({}));

// незамоканный запрос валит тест, а не уходит в сеть
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
