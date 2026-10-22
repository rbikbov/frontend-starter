# Frontend starter

Шаблон фронтенд-проекта на Next.js 16 с фундаментом и агентным слоем. Копия этой папки —
проект, в котором линтер с границами FSD, типы, тесты, e2e и CI уже работают, а агент с
первой сессии знает правила проекта и процесс работы над фичей.

Собран и проверен 2026-10-22: Next 16.4.2, React 19.3, TypeScript 5.9, ESLint 9,
Vitest 5, MSW 3, Playwright 1.64, Tailwind 4.3, pnpm 10, Node 22.

## Новый проект

```bash
rsync -a --exclude node_modules --exclude .next --exclude test-results \
  --exclude playwright-report --exclude .env.local \
  ~/pet/frontend-starter/ ~/pet/<project>/
cd ~/pet/<project>
git init                 # до pnpm install: husky ставит хуки только в git-репозиторий
pnpm install
cp .env.example .env.local
pnpm dev
```

Затем:

1. Название: `name` в `package.json`, заголовок `AGENTS.md`, `metadata` в `app/layout.tsx`.
2. `docs/adr/0001-foundation.md`: дата, автор, и пройди таблицу решений — подходят ли они
   продукту.
3. Лишние скиллы из `.claude/skills/` удали (что можно удалять — `.claude/skills/README.md`).
4. Главную страницу (`src/_pages/home`) замени первой фичей — по процессу ниже.
5. Первый коммит: `git add -A && git commit -m "chore: scaffold from frontend-starter"`.

## Что внутри

| Часть           | Что сделано                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Структура       | Маршруты в корневом `app/`, слои FSD в `src/` (`_app`, `_pages`, `shared`; остальные слои — с первым слайсом)                                                          |
| Границы слоёв   | `eslint-plugin-boundaries`: импорт только вниз, в чужой слайс — через `index.ts`. Проверено на заведомых нарушениях                                                    |
| Сеть и ошибки   | `request()` со схемой zod, `AppError` с `kind` (сеть, отмена, статусы, Retry-After, ответ не по контракту), повторы только для сети и 5xx. 18 тестов                   |
| Окружение       | `clientEnv` со схемой zod, `process.env` вне `shared/config` запрещён линтером                                                                                         |
| UI              | Tailwind v4, токены в CSS-переменных (имена как в shadcn/ui, светлая и тёмная тема), `Button` с `type="button"` по умолчанию                                           |
| Страницы ошибок | `error.tsx` с `retry()`, `global-error.tsx`, `not-found.tsx`                                                                                                           |
| Мониторинг      | Порт логгера в `shared/lib`, реализация в `_app`: JSON-логи в продакшене, контекст только из примитивов                                                                |
| Безопасность    | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, без `X-Powered-By`                                                                                     |
| `/api/health`   | Проверка живости для деплоя, не пререндерится и не кэшируется                                                                                                          |
| Тесты           | Vitest + Testing Library + MSW (незамоканный запрос валит тест); Playwright против продакшен-сборки: главная без ошибок в консоли, 404, health, заголовки безопасности |
| Качество        | husky + lint-staged + commitlint (Conventional Commits), Prettier с сортировкой классов                                                                                |
| CI              | GitHub Actions: lint, формат, типы, тесты, сборка; e2e отдельной job                                                                                                   |

## Скрипты

| Команда       | Что делает                                                      |
| ------------- | --------------------------------------------------------------- |
| `pnpm dev`    | Dev-сервер на :3000                                             |
| `pnpm check`  | Линтер, типы (`next typegen && tsc`), unit и компонентные тесты |
| `pnpm e2e`    | Собирает прод, поднимает на :3100, гоняет Playwright            |
| `pnpm format` | Prettier                                                        |
| `pnpm build`  | Продакшен-сборка                                                |

Перед первым `pnpm e2e` на машине: `pnpm exec playwright install chromium`.

## Агентный слой

| Файл                                                               | Зачем                                                                                                                             |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` (+ `CLAUDE.md`, который его импортирует)               | Читается в начале каждой сессии: команды, карта, 9 правил, процесс. Короткий намеренно — то, что нужно всегда                     |
| `app/`, `src/shared/api/`, `src/shared/config/` — свои `AGENTS.md` | Правила домена, подгружаются, когда агент работает в этой папке                                                                   |
| `.claude/skills/`                                                  | `fsd-frontend`, `feature-workflow`, `anti-slop-review`, `frontend-auth-session`, `adr-writer`, `frontend-bootstrap`               |
| `.claude/agents/reviewer.md`                                       | Субагент для независимого ревью: чистый контекст, diff, критерии из PRD                                                           |
| `docs/features/_template/`                                         | PRD, спецификация, задачи — состояние фичи живёт в файлах, а не в переписке                                                       |
| `docs/adr/`                                                        | Шаблон ADR и ADR-0001 с решениями шаблона                                                                                         |
| Блок Next.js в `AGENTS.md`                                         | Ставит и обновляет `next dev`: указывает агенту на документацию установленной версии в `node_modules/next/dist/docs/`. Не удалять |

Процесс фичи (`feature-workflow`): PRD с Non-Goals → спецификация до 150 строк → задачи по
одной на коммит → read-only исследование → tracer bullet → тест сначала для логики →
ревью субагентом → проверка в браузере. Три неудачные попытки подряд — остановка и
вопрос человеку.

## Сторонние скиллы

Не включены в шаблон: обновляются у авторов. Это инструкции, которые выполняет агент, —
читай их перед установкой, как любую зависимость, и не ставь два скилла на одну тему.

| Скилл                                                                                                                                 | Зачем                                                             | Установка                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `next-dev-loop` ([Next.js](https://nextjs.org/blog/next-16-3-ai-improvements))                                                        | Агент проверяет правки в браузере: консоль, сеть, дерево React    | `npm i -g agent-browser@^0.27`, затем `npx skills add vercel/next.js --skill next-dev-loop` |
| `react-best-practices` ([vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills))                                      | Производительность React и Next: водопады запросов, размер бандла | `npx skills add vercel-labs/agent-skills`, выбрать этот скилл                               |
| `performance`, `core-web-vitals`, `accessibility` ([addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills)) | Web Vitals по измерениям, доступность по WCAG 2.2                 | `npx skills add addyosmani/web-quality-skills`, выбрать нужные                              |
| Sentry ([getsentry/sentry-for-ai](https://github.com/getsentry/sentry-for-ai))                                                        | Подключение Sentry, когда придёт время мониторинга                | По README репозитория                                                                       |

Что проверено: репозитории существуют, принадлежат авторам из таблицы, лицензия MIT у
Vercel и Османи. Содержимое скиллов перед установкой не проверялось.

## Обновление зависимостей

- Next: `npx @next/codemod@canary upgrade latest`, затем прочитай заметки о версии.
- Остальное: `pnpm up --latest`, по одному мажору за раз.
- После любого обновления: `pnpm check && pnpm e2e`. Мажорные версии здесь уже меняли API
  без ошибок на этапе установки: в MSW 3 переименована опция для незамоканных запросов (старое
  имя тихо игнорируется), в `eslint-plugin-boundaries` 7 — формат правил.
