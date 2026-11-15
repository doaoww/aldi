import { z } from "zod";
import { createVoiceSession } from "@/application/voice";
import { ports } from "@/infrastructure/container";
import { handle } from "../../_lib/http";

export const POST = handle(["PATIENT"], async ({ actor, body }) =>
  createVoiceSession(ports(), actor, (await body(z.strictObject({ intakeId: z.string().min(1).max(100) }))).intakeId),
);
