import { z } from "zod";
import { listExercises } from "@/application/exercises";
import { handle, localeSchema } from "../_lib/http";

// Каталог доступен после входа и без разговора.
export const GET = handle(["PATIENT", "DOCTOR", "ADMIN"], async ({ query }) =>
  listExercises(query(z.object({ locale: localeSchema })).locale),
);
