# Скиллы для фронтенда

Набор для ведения фронтенд-проекта на Next.js + TypeScript.
Скиллы независимы: лишний можно удалить, остальные продолжат работать.
Ссылки между ними мягкие («если в проекте есть скилл X») — без адресата
агент просто пропустит ссылку.

| Скилл | Когда срабатывает | Ссылается на |
|---|---|---|
| `fsd-frontend` | Пишешь или ревьюишь код: слои FSD, DI, состояние, ошибки, тесты | — |
| `frontend-bootstrap` | Создаёшь проект или закладываешь фундамент: структура Next + FSD, конфиги, env, API-клиент, CI | `fsd-frontend`, `frontend-auth-session`, `anti-slop-review` |
| `frontend-auth-session` | Вход, регистрация, восстановление пароля, защищённые страницы, refresh токена | `fsd-frontend`, `frontend-bootstrap` |
| `anti-slop-review` | Перед коммитом, PR или публикацией; ревью кода, написанного с ИИ | — |
| `feature-workflow` | Фича или заметное изменение поведения: PRD → спецификация → задачи → tracer bullet → тест сначала → ревью → браузер | `fsd-frontend`, `anti-slop-review`, `frontend-auth-session` |
| `adr-writer` | Записываешь архитектурное решение | — |

## Что удалять

- Нет авторизации → `frontend-auth-session`.
- Проект уже стоит на ногах → `frontend-bootstrap` больше не нужен для
  ежедневной работы, но полезен как чек-лист при аудите.
- Не Next.js → `frontend-bootstrap` и `frontend-auth-session` написаны под
  него; `fsd-frontend` и `anti-slop-review` от фреймворка не зависят.
- ADR не ведутся → `adr-writer`.

## Источник

`adr-writer` взят из
[kfreiman/engineer-challenge](https://github.com/kfreiman/engineer-challenge/blob/master/.agents/skills/adr-writer/SKILL.md)
без изменений.
