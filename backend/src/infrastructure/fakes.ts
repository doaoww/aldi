import type { Ports } from "@/domain/ports";
import { FIELD_KEYS, type ExtractedCard, type FieldKey } from "@/domain/types";
import { AppError } from "@/domain/errors";

// Заглушки внешних сервисов для разработки и автотестов (AI_MODE=fake).
// Позволяют пройти весь путь без ключей OpenRouter и ElevenLabs. В проде не включать.
const empty = () =>
  Object.fromEntries(FIELD_KEYS.map((k) => [k, { value: null, quote: null }])) as ExtractedCard["fields"];

export const fakePorts: Ports = {
  assistant: {
    async reply(history) {
      return `[fake] Спасибо, что рассказали. Реплик от вас: ${history.filter((m) => m.role === "patient").length}.`;
    },
  },
  extractor: {
    async extract(messages) {
      const patient = messages.filter((m) => m.role === "patient");
      if (patient.some((m) => m.text.includes("__LLM_FAIL__"))) throw new AppError("LLM_UNAVAILABLE");
      const fields = empty();
      const first = patient[0]?.text ?? null;
      fields.complaint = { value: first, quote: first };
      // Намеренно «выдуманная» цитата и цитата из слов помощницы — чтобы тесты видели, что они не подтверждаются.
      fields.frequency = { value: "каждый день", quote: "этого пациентка не говорила" };
      const assistant = messages.find((m) => m.role === "assistant");
      if (assistant) fields.impact = { value: "из слов помощницы", quote: assistant.text };
      return { fields, doctorQuestions: ["К какому специалисту обратиться?"] };
    },
  },
  translator: {
    async translate(card, _from, to) {
      const fields = Object.fromEntries(
        FIELD_KEYS.map((k: FieldKey) => [
          k,
          {
            value: card.fields[k].value && `[${to}] ${card.fields[k].value}`,
            quoteTranslation: card.fields[k].quote && `[${to}] ${card.fields[k].quote}`,
          },
        ]),
      ) as Awaited<ReturnType<Ports["translator"]["translate"]>>["fields"];
      return { fields, doctorQuestions: card.doctorQuestions.map((q) => `[${to}] ${q}`) };
    },
  },
  voice: {
    async createSession() {
      return { sessionUrl: "wss://fake.invalid/voice-session" };
    },
    async getTranscript(conversationId) {
      // Формат для тестов: "fake:<intakeId>" — готовый разговор, привязанный к этому intake.
      const intakeId = conversationId.startsWith("fake:") ? conversationId.slice(5) : null;
      return {
        intakeId,
        ready: intakeId !== null,
        messages: [
          { role: "assistant", text: "Как вы себя чувствуете?" },
          { role: "patient", text: "После родов подтекает, когда чихаю." },
        ],
      };
    },
    async deleteConversation() {
      return true;
    },
  },
  notifier: {
    async notifyNewShare() {
      if (process.env.FAKE_NOTIFY_FAIL === "true") throw new Error("fake notifier failure");
      return "SKIPPED";
    },
  },
};
