"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { createQueryClient } from "@/shared/api";

export function AppProviders({ children }: { children: ReactNode }) {
  // useState, not a module variable: on the server the module is shared across requests from different users
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
