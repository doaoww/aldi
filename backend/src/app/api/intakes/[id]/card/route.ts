import { z } from "zod";
import { editCard } from "@/application/intakes";
import { FIELD_KEYS, type FieldKey } from "@/domain/types";
import { handle, type IdParams } from "../../../_lib/http";

const value = z.string().max(1000).nullable().optional();
const schema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  changes: z.strictObject({
    // Неизвестные поля карточки отклоняются.
    fields: z.strictObject(Object.fromEntries(FIELD_KEYS.map((k) => [k, value])) as Record<FieldKey, typeof value>).optional(),
    doctorQuestions: z.array(z.string().max(300)).max(10).optional(),
  }),
});

export const PATCH = handle<IdParams>(["PATIENT"], async ({ actor, params, body }) =>
  editCard(actor, params.id, await body(schema)),
);
