import { describe, expect, it } from "vitest";
import { ERROR_MESSAGES } from "@/domain/errors";
import { verifyQuotes } from "@/domain/quotes";
import { checkSafety, SAFETY_REPLY } from "@/domain/safety";
import { FIELD_KEYS, LOCALES, type ExtractedCard } from "@/domain/types";

const card = (over: Partial<ExtractedCard["fields"]>): ExtractedCard => ({
  fields: { ...Object.fromEntries(FIELD_KEYS.map((k) => [k, { value: null, quote: null }])), ...over } as ExtractedCard["fields"],
  doctorQuestions: [],
});

describe("проверка цитат", () => {
  const talk = [
    { role: "assistant" as const, text: "Как часто это бывает? Каждый день?" },
    { role: "patient" as const, text: "Я родила полгода назад. Подтекает, когда чихаю!" },
  ];

  it("подтверждает дословную цитату пациентки без учёта регистра и пунктуации", () => {
    const f = verifyQuotes(card({ complaint: { value: "подтекание", quote: "подтекает когда чихаю" } }), talk);
    expect(f.complaint.quoteVerified).toBe(true);
  });

  it("не подтверждает выдуманную цитату, но значение оставляет", () => {
    const f = verifyQuotes(card({ complaint: { value: "боль", quote: "очень сильно болит" } }), talk);
    expect(f.complaint).toMatchObject({ value: "боль", quoteVerified: false });
  });

  it("не принимает слова помощницы за цитату пациентки", () => {
    const f = verifyQuotes(card({ frequency: { value: "каждый день", quote: "каждый день" } }), talk);
    expect(f.frequency.quoteVerified).toBe(false);
  });

  it("не подтверждает часть слова", () => {
    const f = verifyQuotes(card({ complaint: { value: "x", quote: "чих" } }), talk);
    expect(f.complaint.quoteVerified).toBe(false);
  });

  it("поле без значения не получает цитату", () => {
    const f = verifyQuotes(card({ impact: { value: null, quote: "подтекает" } }), talk);
    expect(f.impact).toMatchObject({ value: null, quote: null, quoteVerified: false });
  });

  it("казахские буквы не сливаются с похожими русскими", () => {
    const kk = [{ role: "patient" as const, text: "Қатты ауырады" }];
    expect(verifyQuotes(card({ complaint: { value: "x", quote: "қатты ауырады" } }), kk).complaint.quoteVerified).toBe(true);
    expect(verifyQuotes(card({ complaint: { value: "x", quote: "катты ауырады" } }), kk).complaint.quoteVerified).toBe(false);
  });

  it("узбекские апострофы: разные знаки апострофа совпадают, слово без апострофа — нет", () => {
    const uz = [{ role: "patient" as const, text: "Boshim qattiq og‘riyapti" }];
    expect(verifyQuotes(card({ complaint: { value: "x", quote: "qattiq og'riyapti" } }), uz).complaint.quoteVerified).toBe(true);
    expect(verifyQuotes(card({ complaint: { value: "x", quote: "qattiq ogriyapti" } }), uz).complaint.quoteVerified).toBe(false);
  });
});

describe("опасные слова", () => {
  it.each([
    ["Прокладка промокает за час", "bleeding"],
    ["у меня температура 39", "fever"],
    ["иногда не хочу жить", "self_harm"],
    ["I have chest pain", "chest"],
    ["қатты қан кетіп жатыр", "bleeding"],
    ["yashagim kelmayapti", "self_harm"],
    ["Говорю по-русски, but I can't breathe", "chest"],
  ])("%s → %s", (text, category) => {
    expect(checkSafety(text)).toBe(category);
  });

  it("обычный рассказ не помечается", () => {
    expect(checkSafety("Всё хорошо, устаю только. Родила час назад, прокладки купила.")).toBeNull();
  });
});

describe("четыре языка", () => {
  it("тексты ошибок есть на каждом языке с одинаковыми ключами", () => {
    const keys = Object.keys(ERROR_MESSAGES.ru).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(ERROR_MESSAGES[locale]).sort()).toEqual(keys);
      for (const text of Object.values(ERROR_MESSAGES[locale])) expect(text.length).toBeGreaterThan(0);
    }
  });

  it("срочный ответ есть на каждом языке", () => {
    for (const locale of LOCALES) expect(SAFETY_REPLY[locale].length).toBeGreaterThan(20);
  });
});
