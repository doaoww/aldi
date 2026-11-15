# Aldi — три основных контракта API

Полный список маршрутов — в `API_CONTRACTS.md`.

Общее для всех трёх: нужна сессия пациентки (cookie `aldi_session`), успех приходит как `{ "data": ... }`, ошибка как `{ "error": { "code", "message" } }`. Чужой разговор отвечает `404 NOT_FOUND`.

## 1. Создание разговора

`POST /api/intakes`

```json
{ "locale": "ru", "consentVersion": "v1", "consent": true, "country": "KZ" }
```

- `locale`: `ru | kk | uz | en`.
- `consent`: только `true` — это согласие на обработку для разговора, не на отправку врачу.
- `country`: необязательно, двухбуквенный код; от него зависят экстренные контакты.
- Заголовок `Idempotency-Key` необязателен: повтор с тем же ключом вернёт тот же разговор.

Ответ:

```json
{ "data": { "id": "…", "status": "IN_PROGRESS" } }
```

Ошибки: `400 CONSENT_REQUIRED`, `400 UNSUPPORTED_LOCALE`, `400 INVALID_INPUT` (в том числе лишние поля вроде `patientId`), `429 RATE_LIMITED`.

## 2. Отправка сообщения

`POST /api/intakes/:id/messages`

```json
{ "message": "После родов подтекает, когда чихаю.", "clientMessageId": "случайная-строка-от-фронта" }
```

- `message`: от 1 до 4000 символов.
- `clientMessageId`: повтор с тем же значением не создаёт вторую реплику и возвращает ту же пару.

Ответ:

```json
{
  "data": {
    "message": { "id": "…", "role": "patient", "text": "…", "language": "ru" },
    "assistantMessage": { "id": "…", "role": "assistant", "text": "…", "language": "ru" },
    "urgent": false,
    "urgentReason": null
  }
}
```

- При опасном сообщении приходит `urgent: true`, а `assistantMessage` содержит заготовленный текст вместо ответа модели. Статус разговора при этом не меняется.
- `409 INTAKE_CLOSED` — разговор уже завершён.
- `503 LLM_UNAVAILABLE` — реплика пациентки сохранена; повтор с тем же `clientMessageId` дозапросит ответ.
- `429 RATE_LIMITED` — больше 30 сообщений в минуту.

## 3. Завершение и формирование карточки

`POST /api/intakes/:id/complete`

```json
{ "expectedVersion": 0 }
```

Для голосового разговора добавляется `"conversationId": "…"` из ElevenLabs; транскрипт сервер забирает у провайдера сам.

Ответ:

```json
{
  "data": {
    "status": "READY",
    "processingStatus": "DONE",
    "urgent": false,
    "urgentReason": null,
    "card": {
      "version": 1,
      "sourceLocale": "ru",
      "fields": {
        "complaint": { "value": "…", "quote": "…", "quoteVerified": true, "editedByPatient": false }
      },
      "doctorQuestions": ["…"]
    }
  }
}
```

- В `fields` всегда восемь ключей: `time_since_birth`, `birth_info`, `complaint`, `triggers`, `frequency`, `impact`, `tried_or_told`, `own_question`.
- Врачу ничего не уходит: отправка — отдельный запрос `share`.
- Повторный вызов возвращает уже готовую карточку и ничего не пересоздаёт.
- Если обработка ещё идёт от параллельного запроса, приходит `processingStatus: "PROCESSING"` и `card: null`.

Ошибки:

| Код | Что значит | Что делать фронту |
|---|---|---|
| `409 EMPTY_CONVERSATION` | нет ни одной реплики пациентки | вернуть в разговор |
| `409 TRANSCRIPT_NOT_READY` | провайдер ещё обрабатывает запись | повторить через несколько секунд |
| `409 VERSION_CONFLICT` | `expectedVersion` не 0, а карточки ещё нет | перечитать разговор |
| `403 FORBIDDEN` | `conversationId` относится к другому разговору | показать ошибку |
| `503 LLM_UNAVAILABLE` | модель недоступна; разговор сохранён | кнопка «Повторить» |
