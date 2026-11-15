import { AppError } from "@/domain/errors";
import type { CardFields } from "@/domain/types";
import { db } from "@/infrastructure/db";
import type { Actor } from "./auth";
import { cardView } from "./intakes";
import { requireDoctor } from "./patients";

// Врач видит только то, что пациентка сама отправила именно ему,
// и только пока между ними есть активная связь в его клинике.
const visible = (doctorId: string, clinicId: string) => ({
  doctorId,
  intake: { patient: { clinicId, doctors: { some: { doctorId, active: true } } } },
});

export async function listSharedIntakes(actor: Actor, q: { page: number; pageSize: number }) {
  const { doctorId, clinicId } = requireDoctor(actor);
  // Если пациентка отправила несколько версий, в списке показываем последнюю.
  const shares = await db.share.findMany({
    where: visible(doctorId, clinicId),
    orderBy: [{ intakeId: "asc" }, { cardVersion: "desc" }],
    distinct: ["intakeId"],
    include: { intake: { include: { patient: { select: { id: true, displayName: true } } } } },
  });
  const cards = await db.cardVersion.findMany({
    where: { OR: shares.map((s) => ({ intakeId: s.intakeId, version: s.cardVersion })) },
  });
  const cardOf = new Map(cards.map((c) => [`${c.intakeId}:${c.version}`, c]));

  const items = shares
    .map((s) => {
      const fields = cardOf.get(`${s.intakeId}:${s.cardVersion}`)?.fields as CardFields | undefined;
      return {
        intakeId: s.intakeId,
        shareId: s.id,
        cardVersion: s.cardVersion,
        sharedAt: s.createdAt,
        status: s.reviewedAt ? "REVIEWED" : "SHARED",
        urgent: s.intake.urgent,
        patient: s.intake.patient,
        summary: fields?.complaint.value ?? null,
      };
    })
    // Срочные сверху, дальше новые.
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.sharedAt.getTime() - a.sharedAt.getTime());

  const start = (q.page - 1) * q.pageSize;
  return { items: items.slice(start, start + q.pageSize), total: items.length, page: q.page, pageSize: q.pageSize };
}

async function latestShare(actor: Actor, intakeId: string) {
  const { doctorId, clinicId } = requireDoctor(actor);
  const share = await db.share.findFirst({
    where: { ...visible(doctorId, clinicId), intakeId },
    orderBy: { cardVersion: "desc" },
    include: { intake: { include: { patient: { select: { id: true, displayName: true } } } } },
  });
  if (!share) throw new AppError("NOT_FOUND");
  return share;
}

export async function getSharedIntake(actor: Actor, intakeId: string) {
  const share = await latestShare(actor, intakeId);
  const card = await db.cardVersion.findUniqueOrThrow({
    where: { intakeId_version: { intakeId, version: share.cardVersion } },
  });
  // Транскрипт разговора врачу не отдаём: пациентка отправляла карточку, а не весь разговор.
  return {
    intakeId,
    shareId: share.id,
    sharedAt: share.createdAt,
    status: share.reviewedAt ? "REVIEWED" : "SHARED",
    reviewedAt: share.reviewedAt,
    urgent: share.intake.urgent,
    urgentReason: share.intake.urgentReason,
    locale: share.intake.locale,
    patient: share.intake.patient,
    card: cardView(card),
    // Пациентка могла исправить карточку после отправки; врач видит именно отправленную версию.
    newerDraftExists: share.intake.version > share.cardVersion,
  };
}

export async function markReviewed(actor: Actor, intakeId: string) {
  const share = await latestShare(actor, intakeId);
  if (!share.reviewedAt) {
    await db.$transaction([
      db.share.update({ where: { id: share.id }, data: { reviewedAt: new Date() } }),
      db.intake.updateMany({ where: { id: intakeId, status: "SHARED", version: share.cardVersion }, data: { status: "REVIEWED" } }),
    ]);
  }
  return getSharedIntake(actor, intakeId);
}
