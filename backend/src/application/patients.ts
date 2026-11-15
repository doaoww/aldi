import { AppError } from "@/domain/errors";
import type { Locale } from "@/domain/types";
import { db } from "@/infrastructure/db";
import { hashToken, newToken } from "@/infrastructure/security";
import type { Actor } from "./auth";

const INVITATION_HOURS = () => Number(process.env.INVITATION_TTL_HOURS ?? 72);

export function requireDoctor(actor: Actor) {
  if (actor.role !== "DOCTOR" || !actor.doctorId || !actor.clinicId) throw new AppError("FORBIDDEN");
  return { doctorId: actor.doctorId, clinicId: actor.clinicId };
}

// Пациентка доступна врачу, только если она в его клинике и между ними есть активная связь.
// Чужая пациентка выглядит как несуществующая (404), чтобы не подтверждать, что такой ID есть.
async function linkedPatient(actor: Actor, patientId: string) {
  const { doctorId, clinicId } = requireDoctor(actor);
  const patient = await db.patientProfile.findFirst({
    where: { id: patientId, clinicId, doctors: { some: { doctorId, active: true } } },
  });
  if (!patient) throw new AppError("NOT_FOUND");
  return patient;
}

async function issueInvitation(patientId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITATION_HOURS() * 3600_000);
  await db.$transaction([
    db.invitation.updateMany({ where: { patientId, status: "PENDING" }, data: { status: "REVOKED" } }),
    db.invitation.create({ data: { patientId, tokenHash: hashToken(token), expiresAt } }),
  ]);
  // Токен возвращается один раз и нигде не хранится. Врач передаёт его пациентке согласованным каналом.
  return { token, expiresAt };
}

type PatientRow = { id: string; displayName: string; locale: string; contact: string | null; status: string; createdAt: Date };
const view = (p: PatientRow) => ({
  id: p.id, displayName: p.displayName, locale: p.locale, contact: p.contact, status: p.status, createdAt: p.createdAt,
});

export async function listPatients(actor: Actor, q: { search?: string; status?: "INVITED" | "ACTIVE" | "ARCHIVED"; page: number; pageSize: number }) {
  const { doctorId, clinicId } = requireDoctor(actor);
  const where = {
    clinicId,
    doctors: { some: { doctorId, active: true } },
    ...(q.status && { status: q.status }),
    ...(q.search && { displayName: { contains: q.search, mode: "insensitive" as const } }),
  };
  const [total, items] = await Promise.all([
    db.patientProfile.count({ where }),
    db.patientProfile.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { items: items.map(view), total, page: q.page, pageSize: q.pageSize };
}

export async function createPatient(actor: Actor, input: { displayName: string; locale: Locale; contact?: string }) {
  const { doctorId, clinicId } = requireDoctor(actor);
  const patient = await db.patientProfile.create({
    data: {
      clinicId, displayName: input.displayName, locale: input.locale, contact: input.contact ?? null,
      doctors: { create: { doctorId } },
    },
  });
  return { patient: view(patient), invitation: await issueInvitation(patient.id) };
}

export async function getPatient(actor: Actor, patientId: string) {
  const patient = await linkedPatient(actor, patientId);
  const { doctorId } = requireDoctor(actor);
  // Профиль виден сразу, а разговоры и карточки — только те, что пациентка сама отправила этому врачу.
  const shares = await db.share.findMany({
    where: { doctorId, intake: { patientId } },
    orderBy: { createdAt: "desc" },
    include: { intake: { select: { urgent: true } } },
  });
  return {
    patient: view(patient),
    sharedCards: shares.map((s) => ({
      intakeId: s.intakeId, cardVersion: s.cardVersion, sharedAt: s.createdAt, reviewedAt: s.reviewedAt, urgent: s.intake.urgent,
    })),
  };
}

export async function updatePatient(actor: Actor, patientId: string, input: { displayName?: string; contact?: string | null; locale?: Locale }) {
  const patient = await linkedPatient(actor, patientId);
  return { patient: view(await db.patientProfile.update({ where: { id: patient.id }, data: input })) };
}

export async function reinvite(actor: Actor, patientId: string) {
  const patient = await linkedPatient(actor, patientId);
  if (patient.status === "ARCHIVED") throw new AppError("FORBIDDEN");
  return { invitation: await issueInvitation(patient.id) };
}
