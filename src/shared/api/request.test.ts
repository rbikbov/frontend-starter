import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { server } from "@/shared/lib/test/msw-server";

import { AppError } from "./app-error";
import { request } from "./request";

const URL = "https://api.test/items";
const ItemSchema = z.object({ id: z.string() });

async function captureError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe("request", () => {
  it("returns data that matches the schema", async () => {
    server.use(http.get(URL, () => HttpResponse.json({ id: "1" })));

    await expect(request(URL, { schema: ItemSchema })).resolves.toEqual({ id: "1" });
  });

  it("sends the body as JSON", async () => {
    server.use(
      http.post(URL, async ({ request: req }) => {
        expect(req.headers.get("Content-Type")).toBe("application/json");
        return HttpResponse.json({ id: ((await req.json()) as { id: string }).id });
      }),
    );

    await expect(
      request(URL, { method: "POST", body: { id: "2" }, schema: ItemSchema }),
    ).resolves.toEqual({ id: "2" });
  });

  it("maps a network failure to kind network", async () => {
    server.use(http.get(URL, () => HttpResponse.error()));

    const error = await captureError(request(URL, { schema: ItemSchema }));
    expect(error.kind).toBe("network");
  });

  it("maps an aborted request to kind aborted", async () => {
    server.use(http.get(URL, () => HttpResponse.json({ id: "1" })));
    const controller = new AbortController();
    controller.abort();

    const error = await captureError(
      request(URL, { schema: ItemSchema, signal: controller.signal }),
    );
    expect(error.kind).toBe("aborted");
  });

  it.each([
    [400, "validation"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not-found"],
    [409, "conflict"],
    [422, "validation"],
    [429, "rate-limited"],
    [500, "unknown"],
  ] as const)("maps status %i to kind %s", async (status, kind) => {
    server.use(http.get(URL, () => HttpResponse.json({}, { status })));

    const error = await captureError(request(URL, { schema: ItemSchema }));
    expect(error.kind).toBe(kind);
    expect(error.details.status).toBe(status);
  });

  it("keeps the status when the error body is not JSON", async () => {
    server.use(http.get(URL, () => new HttpResponse("<html>Bad gateway</html>", { status: 502 })));

    const error = await captureError(request(URL, { schema: ItemSchema }));
    expect(error).toMatchObject({ kind: "unknown", details: { status: 502 } });
  });

  it("reads field errors and Retry-After", async () => {
    server.use(
      http.get(URL, () =>
        HttpResponse.json(
          { fieldErrors: { email: "taken" } },
          { status: 422, headers: { "Retry-After": "30" } },
        ),
      ),
    );

    const error = await captureError(request(URL, { schema: ItemSchema }));
    expect(error.details).toMatchObject({ fieldErrors: { email: "taken" }, retryAfter: 30 });
  });

  it("rejects a response that does not match the contract", async () => {
    server.use(http.get(URL, () => HttpResponse.json({ id: 1 })));

    const error = await captureError(request(URL, { schema: ItemSchema }));
    expect(error).toMatchObject({
      kind: "unknown",
      message: "Response does not match the contract",
    });
  });
});
