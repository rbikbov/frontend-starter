# src/shared/config — переменные окружения

- Единственное место, где читается `process.env` (остальной код это запрещает линтер).
- `clientEnv` — `NODE_ENV` и `NEXT_PUBLIC_*`. Они встраиваются в бандл при сборке и только
  при прямом обращении: `process.env.NEXT_PUBLIC_X`, без деструктуризации и
  `process.env[name]`.
- Серверные переменные и секреты — в отдельном `env.server.ts`, который создаётся с первой
  такой переменной:

  ```ts
  import "server-only";
  import { z } from "zod";

  const schema = z.object({ API_URL: z.url() });
  export const serverEnv = schema.parse({ API_URL: process.env.API_URL });
  ```

  Импортируется путём `@/shared/config/env.server` и не реэкспортируется из `index.ts`:
  по импорту видно, что модуль серверный, а `server-only` сломает сборку, если он попадёт
  в клиентский бандл.

- Каждая новая переменная — в `.env.example` с комментарием и безопасным значением. Если
  модуль валидирует env при импорте и попадает в тесты — значение и в `test.env` в
  `vitest.config.mts`.
