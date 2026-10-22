# app/ — маршруты Next.js

- Файл маршрута тонкий: реэкспорт страницы из `@/_pages/*`, `generateMetadata`, разбор
  `params` и `searchParams` (это `Promise` — их `await`) и передача пропсами. Логики нет.
- Импортировать можно только `@/_app`, `@/_pages/*` (через `index.ts`) и `@/shared/*` —
  это проверяет линтер.
- Route handlers и Server Actions — публичные эндпоинты: вход валидируется схемой zod,
  авторизация проверяется в каждом, а не в `proxy.ts`.
- `cacheComponents` включён: обработчик или страница без request-time API пререндерятся
  при сборке. Ответ на каждый запрос — `await connection()` из `next/server` или
  `cookies()`/`headers()` (пример — `api/health/route.ts`). Данные пользователя не
  попадают в `"use cache"`.
- `"use client"` — как можно ниже по дереву, не на страницу целиком.
- Границы ошибок: `error.tsx` получает `{ error: unknown; retry: () => void }`;
  `global-error.tsx` рендерит свои `<html>` и `<body>` без глобальных стилей.
- Перед новым файловым соглашением (`loading`, `template`, `proxy`, параллельные маршруты)
  прочитай его страницу в `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`.
