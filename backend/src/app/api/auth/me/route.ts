import { z } from "zod";
import { me, setLocale } from "@/application/auth";
import { handle, localeSchema } from "../../_lib/http";

export const GET = handle(["PATIENT", "DOCTOR", "ADMIN"], ({ actor }) => me(actor));

// Смена языка интерфейса. Уже записанные разговоры при этом не переводятся.
export const PATCH = handle(["PATIENT", "DOCTOR", "ADMIN"], async ({ actor, body }) =>
  setLocale(actor, (await body(z.strictObject({ locale: localeSchema }))).locale),
);
