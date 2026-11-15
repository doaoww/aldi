import { z } from "zod";
import { translateCard } from "@/application/intakes";
import { ports } from "@/infrastructure/container";
import { handle, localeSchema, type IdParams } from "../../../_lib/http";

// Доступно владелице карточки и врачу, которому она отправлена. Оригинал не меняется.
export const POST = handle<IdParams>(["PATIENT", "DOCTOR"], async ({ actor, params, body }) =>
  translateCard(ports(), actor, params.id, await body(z.strictObject({ targetLocale: localeSchema }))),
);
