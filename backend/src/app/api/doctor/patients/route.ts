import { z } from "zod";
import { createPatient, listPatients } from "@/application/patients";
import { handle, localeSchema, paging } from "../../_lib/http";

const listQuery = z.object({
  ...paging,
  search: z.string().trim().max(100).optional(),
  status: z.enum(["INVITED", "ACTIVE", "ARCHIVED"]).optional(),
});

export const GET = handle(["DOCTOR"], async ({ actor, query }) => listPatients(actor, query(listQuery)));

const createSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(100),
  locale: localeSchema,
  contact: z.string().trim().max(200).optional(),
});

export const POST = handle(["DOCTOR"], async ({ actor, body }) => createPatient(actor, await body(createSchema)));
