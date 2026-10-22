"use client";

import { useEffect } from "react";

import { reportError } from "@/_app";

// Заменяет корневой лейаут целиком: глобальные стили и шрифты сюда не доходят,
// поэтому разметка минимальная и с системными цветами.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportError(error, { boundary: "global" });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem", textAlign: "center" }}
      >
        <title>Something went wrong</title>
        <h1>Something went wrong</h1>
        <p>The application failed to load. Try again in a moment.</p>
        <button type="button" onClick={retry}>
          Try again
        </button>
      </body>
    </html>
  );
}
