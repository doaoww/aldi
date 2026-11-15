import { z } from "zod";
import { getPatient, updatePatient } from "@/application/patients";
import { handle, localeSchema, type IdParams } from "../../../_lib/http";

export const GET = handle<IdParams>(["DOCTOR"], ({ actor, params }) => getPatient(actor, params.id));

const schema = z.strictObject({
  displayName: z.string().trim().min(1).max(100).optional(),
  contact: z.string().trim().max(200).nullable().optional(),
  locale: localeSchema.optional(),
});

export const PATCH = handle<IdParams>(["DOCTOR"], async ({ actor, params, body }) =>
  updatePatient(actor, params.id, await body(schema)),
);
