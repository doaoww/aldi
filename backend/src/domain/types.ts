export const LOCALES = ["ru", "kk", "uz", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

export type Role = "PATIENT" | "DOCTOR" | "ADMIN";

export const FIELD_KEYS = [
  "time_since_birth", "birth_info", "complaint", "triggers",
  "frequency", "impact", "tried_or_told", "own_question",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export type Message = { id: string; role: "patient" | "assistant"; text: string; language: Locale };

export type CardField = {
  value: string | null;
  quote: string | null; // всегда на языке оригинала
  quoteVerified: boolean; // цитата дословно найдена в репликах пациентки
  editedByPatient: boolean;
};
export type CardFields = Record<FieldKey, CardField>;
export type Card = { version: number; sourceLocale: Locale; fields: CardFields; doctorQuestions: string[] };

// Что возвращает модель до проверки цитат.
export type ExtractedCard = {
  fields: Record<FieldKey, { value: string | null; quote: string | null }>;
  doctorQuestions: string[];
};

export type TranslatedCard = {
  fields: Record<FieldKey, { value: string | null; quoteTranslation: string | null }>;
  doctorQuestions: string[];
};
