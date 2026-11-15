import { z } from "zod";
import { completeIntake } from "@/application/intakes";
import { ports } from "@/infrastructure/container";
import { handle, type IdParams } from "../../../_lib/http";

const schema = z.strictObject({
  expectedVersion: z.number().int().min(0),
  // Только для голосового разговора: ID разговора у провайдера. Транскрипт сервер забирает сам.
  conversationId: z.string().min(1).max(200).optional(),
});

export const POST = handle<IdParams>(["PATIENT"], async ({ actor, params, body }) =>
  completeIntake(ports(), actor, params.id, await body(schema)),
);
