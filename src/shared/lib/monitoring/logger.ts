/**
 * Log context is primitives only: a whole object (request, user) can't be passed to the log.
 * No personal data or tokens here: ids, error kind, operation name.
 */
export type LogContext = Record<string, string | number | boolean | null | undefined>;

export type Logger = {
  info: (event: string, context?: LogContext) => void;
  warn: (event: string, context?: LogContext) => void;
  error: (event: string, error: unknown, context?: LogContext) => void;
};

export function createConsoleLogger({ json }: { json: boolean }): Logger {
  const write = (level: "info" | "warn" | "error", event: string, context: object) => {
    if (json) {
      console[level](JSON.stringify({ level, event, ...context }));
    } else {
      console[level](`[${level}] ${event}`, context);
    }
  };

  return {
    info: (event, context = {}) => write("info", event, context),
    warn: (event, context = {}) => write("warn", event, context),
    error: (event, error, context = {}) =>
      write("error", event, { ...context, error: describeError(error) }),
  };
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) };
  const { kind, details, digest } = error as Error & {
    kind?: string;
    details?: { status?: number };
    digest?: string;
  };
  return { name: error.name, message: error.message, kind, status: details?.status, digest };
}
