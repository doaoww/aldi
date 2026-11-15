import { reinvite } from "@/application/patients";
import { handle, type IdParams } from "../../../../_lib/http";

// Новое приглашение; предыдущее отзывается.
export const POST = handle<IdParams>(["DOCTOR"], ({ actor, params }) => reinvite(actor, params.id));
