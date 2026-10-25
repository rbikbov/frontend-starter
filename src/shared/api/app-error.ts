export type AppErrorKind =
  | "network" // no connection, timeout, CORS
  | "unauthorized" // 401
  | "forbidden" // 403
  | "not-found" // 404
  | "validation" // 400, 422
  | "conflict" // 409
  | "rate-limited" // 429
  | "aborted" // request aborted — not shown to the user
  | "unknown";

export type AppErrorDetails = {
  status?: number;
  /** Error codes per form field. The UI translates them into text. */
  fieldErrors?: Record<string, string>;
  /** Seconds from the Retry-After header. */
  retryAfter?: number;
  cause?: unknown;
};

/** The only kind of error above shared/api: the rest of the code doesn't parse Response or statuses. */
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
