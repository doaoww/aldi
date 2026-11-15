import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyQuotes } from "@/domain/quotes";
import { checkSafety } from "@/domain/safety";
import { FIELD_KEYS, type ExtractedCard } from "@/domain/types";

// Диалоги на четырёх языках от ответственного за ИИ (src/infrastructure/llm).
// Проверяем на них правила самого бэкенда: подтверждение цитат и сигнал срочности.
type Case = {
  id: string;
  dialogue: { role: string; text: string }[];
  expected_card: { quote_original: string; escalate: boolean };
};
const cases: Case[] = JSON.parse(readFileSync("src/infrastructure/llm/four-language-dialogues.json", "utf8"));

describe.each(cases)("диалог $id", (c) => {
  const messages = c.dialogue.map((m) => ({ role: m.role === "mother" ? ("patient" as const) : ("assistant" as const), text: m.text }));

  it("ожидаемая цитата подтверждается по репликам пациентки", () => {
    const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, { value: null, quote: null }])) as ExtractedCard["fields"];
    fields.complaint = { value: "x", quote: c.expected_card.quote_original };
    expect(verifyQuotes({ fields, doctorQuestions: [] }, messages).complaint.quoteVerified).toBe(true);
  });

  it(`срочность: ${c.expected_card.escalate ? "должна сработать" : "не должна сработать"}`, () => {
    const said = messages.filter((m) => m.role === "patient").map((m) => m.text).join(" \n ");
    expect(Boolean(checkSafety(said))).toBe(c.expected_card.escalate);
  });
});
