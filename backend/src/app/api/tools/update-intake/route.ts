import { z } from "zod";
import { toolUpdatePreview } from "@/application/voice";
import { FIELD_KEYS } from "@/domain/types";
import { handle } from "../../_lib/http";

const schema = z.strictObject({
  intake_id: z.string().min(1).max(100),
  session_token: z.string().min(1).max(200),
  field: z.enum(FIELD_KEYS),
  value: z.string().max(1000),
  quote: z.string().max(1000),
});

export const POST = handle("tool", async ({ body }) => {
  const b = await body(schema);
  return toolUpdatePreview({ intakeId: b.intake_id, sessionToken: b.session_token, field: b.field, value: b.value, quote: b.quote });
});
