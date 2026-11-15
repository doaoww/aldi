import { AppError } from "@/domain/errors";
import type { Assistant, CardExtractor } from "@/domain/ports";
import { FIELD_KEYS, type ExtractedCard, type FieldKey, type Locale, type Message } from "@/domain/types";
import { env } from "./env";
import { createCompanion } from "./llm/openrouter.mjs";

// Связка с модулем разговора и извлечения карточки (папка ./llm — зона ответственного за ИИ).
// Модуль не меняем: здесь только приводим его к портам бэкенда.
// Подтверждение цитат делает домен (domain/quotes.ts) — одно правило для всего приложения,
// поэтому из ответа модуля берём только value и quote.

type History = Pick<Message, "role" | "text">[];

function companion() {
  try {
    return createCompanion({ apiKey: env("OPENROUTER_API_KEY"), model: env("OPENROUTER_MODEL"), timeoutMs: 45_000 });
  } catch (e) {
    console.error("companion: неверная настройка:", e instanceof Error ? e.message : e);
    throw new AppError("LLM_UNAVAILABLE");
  }
}

// Модуль сообщает о любой неудаче ошибкой без подробностей провайдера; наружу отдаём наш стабильный код.
async function guarded<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof AppError) throw e;
    console.error(`companion: ${what} не удалось`);
    throw new AppError("LLM_UNAVAILABLE");
  }
}

export const companionAssistant: Assistant = {
  async reply(history: History, locale: Locale) {
    const api = companion();
    return (await guarded("ответ", () => api.reply({ messages: history, locale }))).text;
  },
};

export const companionExtractor: CardExtractor = {
  async extract(messages: History, locale: Locale): Promise<ExtractedCard> {
    const api = companion();
    // Одна повторная попытка: модель иногда ошибается в формате JSON.
    const card = await guarded("карточка", async () => {
      try {
        return await api.extract({ messages, locale });
      } catch {
        return api.extract({ messages, locale });
      }
    });
    const fields = Object.fromEntries(
      FIELD_KEYS.map((k: FieldKey) => [k, { value: card.fields[k]?.value?.trim() || null, quote: card.fields[k]?.quote ?? null }]),
    ) as ExtractedCard["fields"];
    return { fields, doctorQuestions: card.doctorQuestions.map((q: string) => q.trim()).filter(Boolean).slice(0, 5) };
  },
};
