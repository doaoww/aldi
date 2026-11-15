import { z } from "zod";
import { createIntake, listIntakes } from "@/application/intakes";
import { handle, localeSchema } from "../_lib/http";

const schema = z.strictObject({
  locale: localeSchema,
  consentVersion: z.string().min(1).max(50),
  // Согласие на обработку для разговора. Согласие на отправку врачу — отдельное действие (share).
  consent: z.literal(true, { error: "CONSENT_REQUIRED" }),
  // Страна задаётся отдельно от языка: от неё зависят экстренные контакты.
  country: z.string().length(2).toUpperCase().optional(),
});

export const POST = handle(["PATIENT"], async ({ actor, body, idempotencyKey }) =>
  createIntake(actor, await body(schema), idempotencyKey),
);

export const GET = handle(["PATIENT"], ({ actor }) => listIntakes(actor));
