import type { ExtractedCard, Locale, Message, TranslatedCard, CardFields } from "./types";

// Порты — только там, где есть настоящая внешняя граница: LLM, голос, уведомления.
// Сценарии (application) зависят от этих интерфейсов; адаптеры подключаются в infrastructure/container.ts.

export interface Assistant {
  reply(history: Pick<Message, "role" | "text">[], locale: Locale): Promise<string>;
}

export interface CardExtractor {
  extract(messages: Pick<Message, "role" | "text">[], locale: Locale): Promise<ExtractedCard>;
}

export interface CardTranslator {
  translate(card: { fields: CardFields; doctorQuestions: string[] }, from: Locale, to: Locale): Promise<TranslatedCard>;
}

export type VoiceTranscript = { intakeId: string | null; ready: boolean; messages: { role: "patient" | "assistant"; text: string }[] };

export interface VoiceProvider {
  createSession(locale: Locale): Promise<{ sessionUrl: string }>;
  getTranscript(conversationId: string): Promise<VoiceTranscript>;
  deleteConversation(conversationId: string): Promise<boolean>;
}

export interface NotificationPort {
  // Без медицинского текста: только сам факт и ссылка в кабинет.
  notifyNewShare(shareId: string, urgent: boolean): Promise<"SENT" | "SKIPPED">;
}

export type Ports = {
  assistant: Assistant;
  extractor: CardExtractor;
  translator: CardTranslator;
  voice: VoiceProvider;
  notifier: NotificationPort;
};
