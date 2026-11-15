import { z } from "zod";
import { requestPasswordReset } from "@/application/auth";
import { handle } from "../../_lib/http";

export const POST = handle("public", async ({ body, ip }) =>
  requestPasswordReset(await body(z.strictObject({ login: z.string().min(1).max(100) })), ip),
);
