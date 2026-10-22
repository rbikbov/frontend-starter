import { QueryClient } from "@tanstack/react-query";

import { isAppError } from "./app-error";

const MAX_RETRIES = 2;

/** Повторяются только временные сбои: 4xx и ответы не по контракту от повтора не исправятся. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES || !isAppError(error)) return false;
  if (error.kind === "network") return true;
  return error.kind === "unknown" && (error.details.status ?? 0) >= 500;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // без staleTime данные, пришедшие с сервера, сразу перезапрашиваются на клиенте
      queries: { staleTime: 60_000, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}
