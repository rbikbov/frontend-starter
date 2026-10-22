"use client";

import { useEffect } from "react";

import { reportError } from "@/_app";
import { Button } from "@/shared/ui";

export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportError(error, { boundary: "route" });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">The page failed to load. Try again in a moment.</p>
      <Button onClick={retry}>Try again</Button>
    </main>
  );
}
