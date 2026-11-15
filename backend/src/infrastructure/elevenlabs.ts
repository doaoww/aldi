import { AppError } from "@/domain/errors";
import type { VoiceProvider } from "@/domain/ports";
import type { Locale } from "@/domain/types";
import { env, optionalEnv } from "./env";

const API = "https://api.elevenlabs.io/v1/convai";

// Для каждого языка можно настроить своего агента (ELEVENLABS_AGENT_ID_KK и т. д.).
// Если отдельного нет — используется общий ELEVENLABS_AGENT_ID.
const agentFor = (locale: Locale) =>
  optionalEnv(`ELEVENLABS_AGENT_ID_${locale.toUpperCase()}`) ?? env("ELEVENLABS_AGENT_ID");
const ourAgents = () =>
  ["", "_RU", "_KK", "_UZ", "_EN"].map((s) => optionalEnv(`ELEVENLABS_AGENT_ID${s}`)).filter(Boolean);

async function call(path: string, init?: RequestInit) {
  try {
    return await fetch(`${API}${path}`, {
      ...init,
      headers: { "xi-api-key": env("ELEVENLABS_API_KEY") },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    console.error("elevenlabs: сеть или не задана настройка:", e instanceof Error ? e.message : e);
    throw new AppError("VOICE_UNAVAILABLE");
  }
}

export const elevenLabsVoice: VoiceProvider = {
  async createSession(locale) {
    const res = await call(`/conversation/get-signed-url?agent_id=${encodeURIComponent(agentFor(locale))}`);
    if (!res.ok) {
      console.error("elevenlabs: signed url, статус", res.status);
      throw new AppError("VOICE_UNAVAILABLE");
    }
    const { signed_url } = await res.json();
    if (typeof signed_url !== "string") throw new AppError("VOICE_UNAVAILABLE");
    return { sessionUrl: signed_url };
  },

  // Транскрипт берём у провайдера, а не у браузера: текст от клиента не считается подтверждённым.
  async getTranscript(conversationId) {
    const res = await call(`/conversations/${encodeURIComponent(conversationId)}`);
    if (res.status === 404) return { intakeId: null, ready: false, messages: [] };
    if (!res.ok) {
      console.error("elevenlabs: conversation, статус", res.status);
      throw new AppError("VOICE_UNAVAILABLE");
    }
    const c = await res.json();
    // Чужой агент — не наш разговор.
    if (!ourAgents().includes(c.agent_id)) return { intakeId: null, ready: false, messages: [] };
    const vars = c.conversation_initiation_client_data?.dynamic_variables ?? {};
    const turns: { role?: string; message?: string | null }[] = Array.isArray(c.transcript) ? c.transcript : [];
    return {
      intakeId: typeof vars.intake_id === "string" ? vars.intake_id : null,
      ready: c.status === "done",
      messages: turns
        .filter((t) => typeof t.message === "string" && t.message.trim())
        .map((t) => ({ role: t.role === "user" ? ("patient" as const) : ("assistant" as const), text: t.message as string })),
    };
  },

  async deleteConversation(conversationId) {
    try {
      const res = await call(`/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
      return res.ok;
    } catch {
      return false;
    }
  },
};
