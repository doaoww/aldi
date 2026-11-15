import { AppError } from "@/domain/errors";
import type { Assistant, CardExtractor } from "@/domain/ports";
import { FIELD_KEYS, type ExtractedCard, type FieldKey, type Locale, type Message } from "@/domain/types";
import { env, optionalEnv } from "./env";
import { createCompanion } from "./llm/openrouter.mjs";

// Связка с модулем разговора и извлечения карточки (папка ./llm — зона ответственного за ИИ).
// Модуль не меняем: здесь только приводим его к портам бэкенда.
// Подтверждение цитат делает домен (domain/quotes.ts) — одно правило для всего приложения,
// поэтому из ответа модуля берём только value и quote.

type History = Pick<Message, "role" | "text">[];
type Companion = ReturnType<typeof createCompanion>;

// Основная модель и необязательная запасная (OPENROUTER_FALLBACK_MODEL).
// Запасная нужна, когда основная недоступна: кончился баланс, лимит запросов, сбой провайдера.
export const llmModels = (): string[] =>
  [env("OPENROUTER_MODEL"), optionalEnv("OPENROUTER_FALLBACK_MODEL")].filter((m): m is string => Boolean(m));

// Пробуем модели по очереди. Модуль сообщает о неудаче без подробностей провайдера;
// наружу отдаём наш стабильный код ошибки.
async function withModels<T>(what: string, attemptsOnPrimary: number, run: (api: Companion) => Promise<T>): Promise<T> {
  let models: string[];
  let apiKey: string;
  try {
    models = llmModels();
    apiKey = env("OPENROUTER_API_KEY");
  } catch (e) {
    console.error("companion: неверная настройка:", e instanceof Error ? e.message : e);
    throw new AppError("LLM_UNAVAILABLE");
  }
  const queue = [...Array(attemptsOnPrimary).fill(models[0]), ...models.slice(1)];
  for (const model of queue) {
    try {
      return await run(createCompanion({ apiKey, model, timeoutMs: 45_000 }));
    } catch {
      console.error(`companion: ${what} не удалось на модели ${model}`);
    }
  }
  throw new AppError("LLM_UNAVAILABLE");
}

export const companionAssistant: Assistant = {
  async reply(history: History, locale: Locale) {
    return (await withModels("ответ", 1, (api) => api.reply({ messages: history, locale }))).text;
  },
};

export const companionExtractor: CardExtractor = {
  async extract(messages: History, locale: Locale): Promise<ExtractedCard> {
    // Две попытки на основной модели: она иногда ошибается в формате JSON.
    const card = await withModels("карточка", 2, (api) => api.extract({ messages, locale }));
    const fields = Object.fromEntries(
      FIELD_KEYS.map((k: FieldKey) => [k, { value: card.fields[k]?.value?.trim() || null, quote: card.fields[k]?.quote ?? null }]),
    ) as ExtractedCard["fields"];
    return { fields, doctorQuestions: card.doctorQuestions.map((q: string) => q.trim()).filter(Boolean).slice(0, 5) };
  },
};
