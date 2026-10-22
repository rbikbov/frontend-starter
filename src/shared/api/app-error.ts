export type AppErrorKind =
  | "network" // нет соединения, таймаут, CORS
  | "unauthorized" // 401
  | "forbidden" // 403
  | "not-found" // 404
  | "validation" // 400, 422
  | "conflict" // 409
  | "rate-limited" // 429
  | "aborted" // запрос отменён — пользователю не показывается
  | "unknown";

export type AppErrorDetails = {
  status?: number;
  /** Коды ошибок по полям формы. Тексты переводит UI. */
  fieldErrors?: Record<string, string>;
  /** Секунды из заголовка Retry-After. */
  retryAfter?: number;
  cause?: unknown;
};

/** Единственный вид ошибки выше shared/api: остальной код не разбирает Response и статусы. */
export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly details: AppErrorDetails;

  constructor(kind: AppErrorKind, message: string, details: AppErrorDetails = {}) {
    super(message, { cause: details.cause });
    this.name = "AppError";
    this.kind = kind;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
