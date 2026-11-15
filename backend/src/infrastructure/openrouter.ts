import { z } from "zod";
import { AppError } from "@/domain/errors";
import type { CardTranslator } from "@/domain/ports";
import { FIELD_KEYS, type FieldKey, type Locale } from "@/domain/types";
import { env } from "./env";

const LANGUAGE: Record<Locale, string> = { ru: "русский", kk: "казахский", uz: "узбекский (латиница)", en: "английский" };

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// Разговор и извлечение карточки — в companion.ts (модуль ./llm). Здесь остался только перевод.
async function chat(messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number; temperature?: number } = {}) {
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("OPENROUTER_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env("OPENROUTER_MODEL"),
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens,
        ...(opts.json && { response_format: { type: "json_object" } }),
        messages,
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    console.error("openrouter: сеть или не задана настройка:", e instanceof Error ? e.message : e);
    throw new AppError("LLM_UNAVAILABLE");
  }
  if (!res.ok) {
    console.error("openrouter: статус", res.status); // тело ответа не логируем
    throw new AppError("LLM_UNAVAILABLE");
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new AppError("LLM_UNAVAILABLE");
  return content;
}

// Просим JSON и проверяем его схемой; одна повторная попытка, если модель ошиблась в формате.
async function chatJson<T>(messages: ChatMessage[], schema: z.ZodType<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    // Лимит длины ответа обязателен: без него OpenRouter резервирует кредиты под максимум модели
    // и на небольшом балансе отвечает 402.
    const raw = await chat(messages, { json: true, maxTokens: 2500 });
    try {
      return schema.parse(JSON.parse(raw.replace(/^```(json)?|```$/g, "").trim()));
    } catch {
      console.error("openrouter: модель вернула неверный JSON, попытка", attempt);
      if (attempt === 2) throw new AppError("LLM_UNAVAILABLE");
    }
  }
}

const fieldsShape = <T extends z.ZodType>(f: T) =>
  z.object(Object.fromEntries(FIELD_KEYS.map((k) => [k, f])) as Record<FieldKey, T>);
const fieldsTemplate = (inner: string) => `{${FIELD_KEYS.map((k) => `"${k}": ${inner}`).join(", ")}}`;

// ---------- Перевод карточки ----------

const TRANSLATE_PROMPT = (from: Locale, to: Locale) => `Переведи карточку пациентки с языка «${LANGUAGE[from]}» на язык «${LANGUAGE[to]}».
На входе JSON: для каждого поля value (формулировка) и quote (дословная цитата женщины), плюс doctorQuestions.
Правила: переводи точно, ничего не добавляй и не убирай, не смягчай и не уточняй смысл. null оставляй null.
quoteTranslation — перевод цитаты; сама цитата остаётся в оригинале и здесь не возвращается.
Верни только JSON вида: {"fields": ${fieldsTemplate('{"value": null, "quoteTranslation": null}')}, "doctorQuestions": []}`;

const translatedSchema = z.object({
  fields: fieldsShape(z.object({ value: z.string().nullable(), quoteTranslation: z.string().nullable() })),
  doctorQuestions: z.array(z.string()),
});

export const openRouterTranslator: CardTranslator = {
  translate(card, from, to) {
    const input = {
      fields: Object.fromEntries(FIELD_KEYS.map((k) => [k, { value: card.fields[k].value, quote: card.fields[k].quote }])),
      doctorQuestions: card.doctorQuestions,
    };
    return chatJson(
      [
        { role: "system", content: TRANSLATE_PROMPT(from, to) },
        { role: "user", content: JSON.stringify(input) },
      ],
      translatedSchema,
    );
  },
};
