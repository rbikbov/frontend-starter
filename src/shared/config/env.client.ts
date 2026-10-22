import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  NEXT_PUBLIC_APP_URL: z.url(),
});

// NODE_ENV и NEXT_PUBLIC_* попадают в клиентский бандл при сборке только при прямом
// обращении: без деструктуризации process.env и без process.env[name].
// Валидация при импорте: неверная конфигурация падает при старте, а не на первом запросе.
export const clientEnv = schema.parse({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
