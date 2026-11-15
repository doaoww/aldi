import { z } from "zod";
import { getSharedIntake, markReviewed } from "@/application/doctor-intakes";
import { handle, type IdParams } from "../../../_lib/http";

export const GET = handle<IdParams>(["DOCTOR"], ({ actor, params }) => getSharedIntake(actor, params.id));

export const PATCH = handle<IdParams>(["DOCTOR"], async ({ actor, params, body }) => {
  await body(z.strictObject({ reviewed: z.literal(true) }));
  return markReviewed(actor, params.id);
});
