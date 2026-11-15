import { z } from "zod";
import { login } from "@/application/auth";
import { handle, Reply, sessionCookie } from "../../_lib/http";

const schema = z.strictObject({ login: z.string().min(1).max(100), password: z.string().min(1).max(200) });

export const POST = handle("public", async ({ body, ip }) => {
  const { token, expiresAt, user } = await login(await body(schema), ip);
  // Сессия — в HttpOnly-cookie. Токен в теле ответа выдаётся только если это явно включено
  // (фронт и API на разных доменах, где сторонние cookie блокируются браузером).
  const data = process.env.AUTH_RETURN_TOKEN === "true" ? { user, token, expiresAt } : { user, expiresAt };
  return new Reply(data, { "Set-Cookie": sessionCookie(token, expiresAt) });
});
