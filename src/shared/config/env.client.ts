import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  NEXT_PUBLIC_APP_URL: z.url(),
});

// NODE_ENV and NEXT_PUBLIC_* are inlined into the client bundle at build time only on direct
// access: no destructuring of process.env and no process.env[name].
// Validated on import: a wrong configuration fails at startup, not on the first request.
export const clientEnv = schema.parse({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
