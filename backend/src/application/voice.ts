import type { Prisma } from "@prisma/client";
import { AppError } from "@/domain/errors";
import type { Ports } from "@/domain/ports";
import { isLocale, type FieldKey } from "@/domain/types";
import { db } from "@/infrastructure/db";
import { rateLimit } from "@/infrastructure/rate-limit";
import { hashToken, newToken } from "@/infrastructure/security";
import type { Actor } from "./auth";
import { requirePatient } from "./intakes";

// Голосовой сеанс привязан к пациентке и разговору. Ключ ElevenLabs остаётся на сервере.
export async function createVoiceSession(ports: Ports, actor: Actor, intakeId: string) {
  const patientId = requirePatient(actor);
  const intake = await db.intake.findFirst({ where: { id: intakeId, patientId } });
  if (!intake) throw new AppError("NOT_FOUND");
  if (intake.status !== "IN_PROGRESS") throw new AppError("INTAKE_CLOSED");
  rateLimit(`voice:${actor.userId}`, 10, 3600);

  const locale = isLocale(intake.locale) ? intake.locale : "ru";
  const { sessionUrl } = await ports.voice.createSession(locale);
  // Одноразовый токен сеанса: агент передаёт его в каждом вызове инструмента.
  // Одного intake_id, названного моделью, недостаточно.
  const sessionToken = newToken();
  await db.intake.update({ where: { id: intakeId }, data: { voiceTokenHash: hashToken(sessionToken) } });
  return {
    sessionUrl,
    // Фронт передаёт это в startSession({ signedUrl, dynamicVariables }).
    dynamicVariables: { intake_id: intakeId, session_token: sessionToken, locale },
  };
}

async function toolIntake(intakeId: string, sessionToken: string) {
  const intake = await db.intake.findFirst({ where: { id: intakeId, voiceTokenHash: hashToken(sessionToken) } });
  if (!intake) throw new AppError("NOT_FOUND");
  return intake;
}

// Живое превью карточки во время голосового разговора.
export async function toolUpdatePreview(input: { intakeId: string; sessionToken: string; field: FieldKey; value: string; quote: string }) {
  const intake = await toolIntake(input.intakeId, input.sessionToken);
  // Опоздавший вызов после завершения разговора игнорируем: финальную карточку превью не трогает.
  if (intake.status !== "IN_PROGRESS") return { ok: true, ignored: true };
  const preview = { ...(intake.preview as Record<string, unknown>), [input.field]: { value: input.value, quote: input.quote } };
  await db.intake.update({ where: { id: intake.id }, data: { preview: preview as Prisma.InputJsonValue } });
  return { ok: true };
}

export async function toolFlagUrgent(input: { intakeId: string; sessionToken: string; reason: string }) {
  const intake = await toolIntake(input.intakeId, input.sessionToken);
  // Повторный вызов ничего не меняет. Флаг виден пациентке; врачу — только вместе с отправленной карточкой.
  if (!intake.urgent) {
    await db.intake.update({ where: { id: intake.id }, data: { urgent: true, urgentReason: input.reason } });
  }
  return { ok: true };
}
