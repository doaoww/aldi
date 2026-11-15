import { deleteIntake, getIntake } from "@/application/intakes";
import { ports } from "@/infrastructure/container";
import { handle, type IdParams } from "../../_lib/http";

export const GET = handle<IdParams>(["PATIENT"], ({ actor, params }) => getIntake(actor, params.id));

export const DELETE = handle<IdParams>(["PATIENT"], ({ actor, params }) => deleteIntake(ports(), actor, params.id));
