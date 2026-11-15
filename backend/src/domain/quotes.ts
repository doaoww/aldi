import { FIELD_KEYS, type CardFields, type ExtractedCard, type Message } from "./types";

// Приводим текст к виду для сравнения: регистр, пунктуация, варианты апострофа.
// Буквы не заменяем (кроме ё→е), чтобы разные казахские и узбекские слова не стали «одинаковыми».
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[’‘ʻʼ`´]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
}

// Цитата подтверждена, только если она целыми словами есть в репликах пациентки.
// Реплики помощницы не считаются. Это проверка совпадения текста, а не медицинской достоверности.
export function verifyQuotes(card: ExtractedCard, messages: Pick<Message, "role" | "text">[]): CardFields {
  const said = messages.filter((m) => m.role === "patient").map((m) => ` ${normalize(m.text)} `);
  const fields = {} as CardFields;
  for (const key of FIELD_KEYS) {
    const { value, quote } = card.fields[key];
    const q = quote ? normalize(quote) : "";
    fields[key] = {
      value,
      quote: value === null ? null : quote,
      quoteVerified: value !== null && q.length > 0 && said.some((s) => s.includes(` ${q} `)),
      editedByPatient: false,
    };
  }
  return fields;
}
