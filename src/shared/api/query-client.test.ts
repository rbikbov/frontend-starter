import { describe, expect, it } from "vitest";

import { AppError } from "./app-error";
import { shouldRetry } from "./query-client";

describe("shouldRetry", () => {
  it("retries network failures and server errors", () => {
    expect(shouldRetry(0, new AppError("network", "Network error"))).toBe(true);
    expect(shouldRetry(1, new AppError("unknown", "HTTP 503", { status: 503 }))).toBe(true);
  });

  it("does not retry client errors, contract mismatches and bugs", () => {
    expect(shouldRetry(0, new AppError("not-found", "HTTP 404", { status: 404 }))).toBe(false);
    expect(
      shouldRetry(
        0,
        new AppError("unknown", "Response does not match the contract", { status: 200 }),
      ),
    ).toBe(false);
    expect(shouldRetry(0, new TypeError("x is undefined"))).toBe(false);
  });

  it("stops after the retry limit", () => {
    expect(shouldRetry(2, new AppError("network", "Network error"))).toBe(false);
  });
});
