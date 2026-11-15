import { z } from "zod";
import { AppError } from "@/domain/errors";
import type { Assistant, CardExtractor, CardTranslator } from "@/domain/ports";
import { FIELD_KEYS, type FieldKey, type Locale } from "@/domain/types";
import { env } from "./env";

const LANGUAGE: Record<Locale, string> = { ru: "русский", kk: "казахский", uz: "узбекский (латиница)", en: "английский" };

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

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
    const raw = await chat(messages, { json: true });
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

// ---------- Помощница в текстовом разговоре ----------

const ASSISTANT_PROMPT = (locale: Locale) => `Ты — Aldi, помощница для женщин после родов. Отвечай только на языке: ${LANGUAGE[locale]}. Спокойно, тепло, без восклицаний.
Твоя задача — дать женщине рассказать о самочувствии своими словами и мягко уточнить факты для карточки врачу.
Ты не врач: не ставишь диагнозов, не называешь болезней, не советуешь лекарства, процедуры и упражнения, не говоришь «это норма» и «ничего страшного», не утверждаешь, что что-то ей подходит.
Правила:
- Коротко: одна-две фразы и не больше одного вопроса за реплику.
- Сначала отрази её слова, потом спроси. Используй её слова, без медицинских терминов.
- За весь разговор не больше четырёх уточняющих вопросов, по одному, только о том, чего ещё нет: сколько прошло после родов, когда это случается, как часто, мешает ли в жизни, говорила ли врачу. В конце один раз спроси, что она хотела бы спросить у врача.
- Если она уходит от ответа — не настаивай.
- На вопросы «это опасно?», «что со мной?», «что делать?» отвечай, что не можешь это оценить и что это вопрос к врачу, его можно добавить в карточку.
- Когда фактов достаточно или она хочет закончить — скажи, что можно завершить разговор и посмотреть карточку, и что отправлять ли её врачу, она решит сама.
- Не обещай, что врач уже что-то получил или следит за разговором.`;

export const openRouterAssistant: Assistant = {
  async reply(history, locale) {
    return chat(
      [
        { role: "system", content: ASSISTANT_PROMPT(locale) },
        ...history.map((m) => ({ role: m.role === "patient" ? ("user" as const) : ("assistant" as const), content: m.text })),
      ],
      { maxTokens: 200, temperature: 0.4 },
    );
  },
};

// ---------- Извлечение карточки ----------

const EXTRACT_PROMPT = (locale: Locale) => `Ты — медицинский регистратор. На входе JSON-транскрипт разговора помощницы Aldi с женщиной после родов.
Собери карточку для врача СТРОГО по правилам:
1. Используй только реплики с role="patient". Реплики помощницы — не источник фактов.
2. Для каждого поля: value — краткая нейтральная формулировка на языке: ${LANGUAGE[locale]} (без диагнозов, без оценок, без слова «норма»); quote — ДОСЛОВНЫЙ фрагмент её реплики на том языке, на котором она это сказала (копируй символ в символ, не переводи и не исправляй).
3. Если факта нет в её словах — value: null, quote: null. Не домысливай.
4. doctorQuestions — до 3 коротких вопросов врачу на языке ${LANGUAGE[locale]}, уместных к её словам, без медицинских терминов. Если фактов нет — пустой список.
5. Никаких названий болезней, лекарств, процедур, упражнений.
Поля: time_since_birth (сколько прошло после родов), birth_info (особенности родов), complaint (что беспокоит), triggers (когда возникает), frequency (как часто), impact (как мешает в жизни), tried_or_told (что пробовала, говорила ли врачу), own_question (её вопрос врачу).
Верни только JSON вида: {"fields": ${fieldsTemplate('{"value": null, "quote": null}')}, "doctorQuestions": []}`;

const extractedSchema = z.object({
  fields: fieldsShape(z.object({ value: z.string().nullable(), quote: z.string().nullable() })),
  doctorQuestions: z.array(z.string()).max(5),
});

export const openRouterExtractor: CardExtractor = {
  extract(messages, locale) {
    return chatJson(
      [
        { role: "system", content: EXTRACT_PROMPT(locale) },
        { role: "user", content: JSON.stringify(messages.map((m) => ({ role: m.role, text: m.text }))) },
      ],
      extractedSchema,
    );
  },
};

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
