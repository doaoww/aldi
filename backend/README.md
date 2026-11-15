# Aldi — бэкенд

Next.js (только API), PostgreSQL, Prisma. Контракты API: `../docs/API_CONTRACTS.md`.

## Структура

```
prisma/            схема, миграция, демоданные (seed.ts)
scripts/           локальная база, создание врача
src/domain/        типы, проверка цитат, опасные слова, тексты ошибок, порты
src/application/   сценарии: вход, пациентки, разговор, карточка, отправка, голос, упражнения
src/infrastructure/ база, OpenRouter, ElevenLabs, Telegram, заглушки, сборка портов (container.ts)
src/app/api/       маршруты: проверка входа и прав, валидация, формат ответа
tests/             unit — без базы; e2e — против запущенного сервера
```

## Запуск локально

```bash
cp .env.example .env          # заполнить ключи; для работы без ключей оставить AI_MODE=fake
npm install
npm run db:dev                # локальный Postgres, держать в отдельном терминале
npx prisma migrate deploy
npm run seed                  # демо: doctor.demo, doctor2.demo, mama.demo, admin.demo; пароль aldi-demo-2026
npm run dev
```

Проверка: `http://localhost:3000/api/health`.

## Тесты

```bash
npm test                      # проверка цитат, опасные слова, тексты на 4 языках
```

Сквозные тесты идут против запущенного сервера с заглушками внешних сервисов:

```bash
AI_MODE=fake FAKE_NOTIFY_FAIL=true TOOL_SECRET=test-tool CORS_ORIGINS=http://app.test npx next dev -p 3987
npm run test:e2e
```

## Деплой на Railway

1. Сервис из репозитория, корневая папка `backend`, плюс сервис PostgreSQL.
2. Переменные — по `.env.example`. `AI_MODE` не задавать.
3. Сборка: `npm run build`. Запуск: `npm start` (сначала применяет миграции).
4. Один раз: `npm run seed` для демо или `npm run create-doctor -- <логин> <пароль> "<имя>" "<клиника>"`.

### Сессии и домены

Сессия — HttpOnly-cookie. Надёжнее всего, когда фронт и API на одном домене: фронт проксирует `/api/*` на Railway, `COOKIE_SAMESITE=lax`.

Если домены разные: `COOKIE_SAMESITE=none`, а фронт шлёт запросы с `credentials: "include"`. Часть браузеров блокирует такие cookie. На этот случай есть `AUTH_RETURN_TOKEN=true`: токен приходит в ответе на вход и принимается в `Authorization: Bearer`. Это менее защищённый вариант.

## Аккаунты

- Врача создаёт администратор командой `create-doctor`.
- Пациентку добавляет врач; она получает одноразовое приглашение и сама задаёт логин и пароль.
- Потерян пароль: врач создаёт новое приглашение, старые сессии пациентки закрываются.
