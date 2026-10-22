# Frontend starter

Next.js 16 (App Router) + TypeScript + Feature-Sliced Design. Этот файл читается в начале
каждой сессии, поэтому здесь только то, что нужно всегда. Подробности — в `AGENTS.md`
папок (подгружаются, когда работаешь в папке) и в скиллах `.claude/skills/`.

## Команды

| Что                     | Команда                                                   |
| ----------------------- | --------------------------------------------------------- |
| Разработка              | `pnpm dev`                                                |
| Проверка перед коммитом | `pnpm check` — lint, typecheck, unit и компонентные тесты |
| e2e                     | `pnpm e2e` — собирает прод и поднимает его на :3100       |
| Форматирование          | `pnpm format`                                             |

Не утверждай, что проверки проходят, пока не запустил их. В выводе тестов и линтера
читай ошибки, а не весь лог.

## Карта

```text
app/                  маршруты Next: тонкие файлы → src/_pages. Правила: app/AGENTS.md
src/_app/             провайдеры, токены дизайна (styles/globals.css), реализация логгера
src/_pages/           страницы (слой pages)
src/widgets|features|entities/   появляются с первым слайсом, пустыми не создаются
src/shared/api/       request(), AppError, QueryClient. Правила: src/shared/api/AGENTS.md
src/shared/config/    переменные окружения. Правила: src/shared/config/AGENTS.md
src/shared/lib|ui/    утилиты, логгер, UI-примитивы
docs/adr/             архитектурные решения;  docs/features/  PRD, спецификации, задачи
e2e/                  Playwright
```

## Правила, которые действуют всегда

1. Импорт только вниз по слоям, в чужой слайс — только через его `index.ts`. Это
   проверяет линтер; не обходи его и не отключай правила.
2. Выше `shared/api` ошибки — только `AppError` с `kind`. Вид ошибки — по коду или
   статусу, не по тексту сообщения.
3. Данные из сети — через `request()` со схемой zod; ответ маппится в доменный тип на
   границе API.
4. `process.env` — только в `src/shared/config`.
5. В логах нет персональных данных и токенов. Токены сессии недоступны JS.
6. Стили — только токены из `src/_app/styles/globals.css`. Класс, которого нет в `@theme`,
   не применяется молча — заведи токен или используй существующий.
7. У каждого асинхронного действия в UI есть загрузка, ошибка, пустое состояние и
   блокировка повторной отправки.
8. Ничего «на будущее»: ни слоёв, ни опций конфига, ни абстракций без потребителя.
9. Факты о Next.js — из `node_modules/next/dist/docs/` (блок ниже), не из памяти.

## Как работать

- Фича или заметное изменение поведения — скилл `feature-workflow`: PRD с Non-Goals →
  спецификация до 150 строк → задачи по одной на коммит → tracer bullet → тест сначала
  для логики → ревью субагентом `reviewer` → проверка в браузере.
- Три неудачные попытки исправить одно и то же — остановись и опиши проблему человеку.
- Решения, которые нужны в следующих сессиях, записывай в `docs/`, а не в переписку.
- Отступление от правила — с причиной в коде или в ADR.

## Скиллы

`fsd-frontend` — как писать код · `feature-workflow` — процесс фичи ·
`anti-slop-review` — проверка перед коммитом и публикацией · `frontend-auth-session` —
вход и сессия · `adr-writer` — ADR · `frontend-bootstrap` — решения фундамента и аудит.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
