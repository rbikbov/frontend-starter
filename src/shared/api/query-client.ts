import { QueryClient } from "@tanstack/react-query";

import { isAppError } from "./app-error";

const MAX_RETRIES = 2;

/** Only transient failures are retried: a retry won't fix a 4xx or a response that breaks the contract. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES || !isAppError(error)) return false;
  if (error.kind === "network") return true;
  return error.kind === "unknown" && (error.details.status ?? 0) >= 500;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // without staleTime, data that came from the server is refetched on the client right away
      queries: { staleTime: 60_000, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}
