import { z } from "zod";
import { listSharedIntakes } from "@/application/doctor-intakes";
import { handle, paging } from "../../_lib/http";

export const GET = handle(["DOCTOR"], async ({ actor, query }) => listSharedIntakes(actor, query(z.object(paging))));
