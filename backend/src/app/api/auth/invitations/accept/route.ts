import { z } from "zod";
import { acceptInvitation } from "@/application/auth";
import { handle, Reply, sessionCookie } from "../../../_lib/http";

const schema = z.strictObject({
  token: z.string().min(10).max(200),
  login: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._@-]+$/),
  password: z.string().min(8).max(200),
});

export const POST = handle("public", async ({ body, ip }) => {
  const { token, expiresAt, user } = await acceptInvitation(await body(schema), ip);
  const data = process.env.AUTH_RETURN_TOKEN === "true" ? { user, token, expiresAt } : { user, expiresAt };
  return new Reply(data, { "Set-Cookie": sessionCookie(token, expiresAt) });
});
