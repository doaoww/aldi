import { logout } from "@/application/auth";
import { handle, Reply, sessionCookie } from "../../_lib/http";

export const POST = handle("public", async ({ token }) => {
  await logout(token);
  return new Reply({ ok: true }, { "Set-Cookie": sessionCookie(null) });
});
