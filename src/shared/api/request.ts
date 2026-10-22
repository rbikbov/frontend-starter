import { z } from "zod";

import { AppError, type AppErrorKind } from "./app-error";

export type RequestOptions<T> = Omit<RequestInit, "body"> & {
  /** Схема ответа: данные не по контракту — ошибка, а не тихий undefined в UI. */
  schema: z.ZodType<T>;
  /** Сериализуется в JSON. */
  body?: unknown;
};

export async function request<T>(
  url: string,
  { schema, body, headers, ...init }: RequestOptions<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError("aborted", "Request aborted", { cause: error });
    }
    throw new AppError("network", "Network error", { cause: error });
  }

  // Тело бывает пустым или не JSON (HTML от прокси) — статус при этом терять нельзя.
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new AppError(kindFromStatus(response.status), `HTTP ${response.status}`, {
      status: response.status,
      fieldErrors: readFieldErrors(payload),
      retryAfter: readRetryAfter(response),
      cause: payload,
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("unknown", "Response does not match the contract", {
      status: response.status,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function kindFromStatus(status: number): AppErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate-limited";
  if (status === 400 || status === 422) return "validation";
  return "unknown";
}

// Формат тела ошибки — договорённость с бэкендом. Поменяй схему под свой контракт.
const ErrorBodySchema = z.object({
  fieldErrors: z.record(z.string(), z.string()).optional(),
});

function readFieldErrors(payload: unknown): Record<string, string> | undefined {
  const parsed = ErrorBodySchema.safeParse(payload);
  return parsed.success ? parsed.data.fieldErrors : undefined;
}

function readRetryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
