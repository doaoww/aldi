import { z } from "zod";
import { toolFlagUrgent } from "@/application/voice";
import { handle } from "../../_lib/http";

const schema = z.strictObject({
  intake_id: z.string().min(1).max(100),
  session_token: z.string().min(1).max(200),
  reason: z.string().trim().min(1).max(200),
});

export const POST = handle("tool", async ({ body }) => {
  const b = await body(schema);
  return toolFlagUrgent({ intakeId: b.intake_id, sessionToken: b.session_token, reason: b.reason });
});
