import { clientEnv } from "@/shared/config";
import { createConsoleLogger, type LogContext } from "@/shared/lib";

// Logger port implementation. Sentry or another service is plugged in here — call sites don't change.
export const logger = createConsoleLogger({ json: clientEnv.NODE_ENV === "production" });

export function reportError(error: unknown, context?: LogContext) {
  logger.error("unhandled_error", error, context);
}
