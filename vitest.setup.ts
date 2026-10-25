import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { server } from "@/shared/lib/test/msw-server";

// server-only throws when imported outside a react-server environment, but modules using it are tested too
vi.mock("server-only", () => ({}));

// an unmocked request fails the test instead of going to the network
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
