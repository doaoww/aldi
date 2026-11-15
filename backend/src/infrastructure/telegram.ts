import type { NotificationPort } from "@/domain/ports";
import { optionalEnv } from "./env";

// Необязательное уведомление врачу. В тексте нет медицинских данных и имени пациентки:
// только факт и ссылка в кабинет, где нужен вход.
export const telegramNotifier: NotificationPort = {
  async notifyNewShare(shareId, urgent) {
    const token = optionalEnv("TELEGRAM_BOT_TOKEN");
    const chatId = optionalEnv("TELEGRAM_CHAT_ID");
    if (!token || !chatId) return "SKIPPED";
    const link = optionalEnv("DOCTOR_APP_URL");
    const text = `${urgent ? "Aldi: новая карточка с отметкой срочности" : "Aldi: новая карточка"}${link ? `\n${link}` : ""}`;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`telegram: статус ${res.status} (share ${shareId})`);
    return "SENT";
  },
};
