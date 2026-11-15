import { z } from "zod";
import { shareIntake } from "@/application/intakes";
import { ports } from "@/infrastructure/container";
import { handle, type IdParams } from "../../../_lib/http";

const schema = z.strictObject({
  cardVersion: z.number().int().min(1),
  doctorId: z.string().min(1).max(100),
  // Отдельное согласие именно на отправку этой версии этому врачу.
  consent: z.literal(true, { error: "CONSENT_REQUIRED" }),
});

export const POST = handle<IdParams>(["PATIENT"], async ({ actor, params, body }) =>
  shareIntake(ports(), actor, params.id, await body(schema)),
);
