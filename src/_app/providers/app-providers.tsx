"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { createQueryClient } from "@/shared/api";

export function AppProviders({ children }: { children: ReactNode }) {
  // useState, а не модульная переменная: на сервере модуль общий для запросов разных пользователей
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
