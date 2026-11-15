import { z } from "zod";
import { getExercise } from "@/application/exercises";
import { handle, localeSchema, type IdParams } from "../../_lib/http";

export const GET = handle<IdParams>(["PATIENT", "DOCTOR", "ADMIN"], async ({ params, query }) =>
  getExercise(params.id, query(z.object({ locale: localeSchema })).locale),
);
