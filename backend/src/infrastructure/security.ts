import bcrypt from "bcryptjs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

// Хеш несуществующего пароля: сравниваем с ним, когда логина нет,
// чтобы по времени ответа нельзя было понять, существует ли аккаунт.
export const DUMMY_HASH = bcrypt.hashSync("no-such-user", 10);

// Случайные токены (сессия, приглашение, голосовой сеанс). В базе лежит только хеш.
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
