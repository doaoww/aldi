import type { Ports } from "@/domain/ports";
import { elevenLabsVoice } from "./elevenlabs";
import { fakePorts } from "./fakes";
import { companionAssistant, companionExtractor } from "./companion";
import { openRouterTranslator } from "./openrouter";
import { telegramNotifier } from "./telegram";

// Единственное место, где порты связываются с конкретными сервисами.
// Сменить модель или голосового провайдера = новый адаптер + одна строка здесь.
const realPorts: Ports = {
  assistant: companionAssistant,
  extractor: companionExtractor,
  translator: openRouterTranslator,
  voice: elevenLabsVoice,
  notifier: telegramNotifier,
};

export function ports(): Ports {
  if (process.env.AI_MODE === "fake") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_FAKE_IN_PROD !== "true") {
      throw new Error("AI_MODE=fake нельзя включать в проде");
    }
    return fakePorts;
  }
  return realPorts;
}
