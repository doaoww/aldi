import { AppError } from "@/domain/errors";

// Счётчик в памяти процесса. Для одного инстанса на Railway этого достаточно;
// при нескольких инстансах лимиты нужно перенести в общее хранилище.
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowSec: number) {
  if (process.env.RATE_LIMIT_DISABLED === "true") return;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return;
  }
  if (++h.count > max) throw new AppError("RATE_LIMITED");
}

export const resetLimit = (key: string) => hits.delete(key);
