# src/shared/config — environment variables

- The only place where `process.env` is read (the linter forbids it everywhere else).
- `clientEnv` holds `NODE_ENV` and `NEXT_PUBLIC_*`. They are inlined into the bundle at
  build time, and only on direct access: `process.env.NEXT_PUBLIC_X`, without
  destructuring and without `process.env[name]`.
- Server variables and secrets go into a separate `env.server.ts`, created with the first
  such variable:

  ```ts
  import "server-only";
  import { z } from "zod";

  const schema = z.object({ API_URL: z.url() });
  export const serverEnv = schema.parse({ API_URL: process.env.API_URL });
  ```

  It is imported as `@/shared/config/env.server` and not re-exported from `index.ts`: the
  import shows that the module is server-only, and `server-only` breaks the build if it
  ends up in the client bundle.

- Every new variable goes into `.env.example` with a comment and a safe value. If a module
  validates env on import and is used in tests, add the value to `test.env` in
  `vitest.config.mts` as well.
