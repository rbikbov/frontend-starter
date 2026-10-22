import { clientEnv } from "@/shared/config";
import { createConsoleLogger, type LogContext } from "@/shared/lib";

// Реализация порта логгера. Sentry или другой сервис подключается здесь — вызовы в коде не меняются.
export const logger = createConsoleLogger({ json: clientEnv.NODE_ENV === "production" });

export function reportError(error: unknown, context?: LogContext) {
  logger.error("unhandled_error", error, context);
}
