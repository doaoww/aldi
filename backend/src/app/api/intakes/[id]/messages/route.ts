import { z } from "zod";
import { addMessage } from "@/application/intakes";
import { ports } from "@/infrastructure/container";
import { handle, type IdParams } from "../../../_lib/http";

const schema = z.strictObject({
  message: z.string().trim().min(1).max(4000),
  clientMessageId: z.string().min(1).max(100),
});

export const POST = handle<IdParams>(["PATIENT"], async ({ actor, params, body }) =>
  addMessage(ports(), actor, params.id, await body(schema)),
);
