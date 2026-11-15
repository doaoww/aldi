import type { Prisma } from "@prisma/client";
import { AppError } from "@/domain/errors";
import type { Ports } from "@/domain/ports";
import { verifyQuotes } from "@/domain/quotes";
import { checkSafety, SAFETY_REPLY } from "@/domain/safety";
import { FIELD_KEYS, isLocale, type CardFields, type FieldKey, type Locale } from "@/domain/types";
import { db } from "@/infrastructure/db";
import { rateLimit } from "@/infrastructure/rate-limit";
import type { Actor } from "./auth";

const json = (v: unknown) => v as Prisma.InputJsonValue;

export function requirePatient(actor: Actor) {
  if (actor.role !== "PATIENT" || !actor.patientId) throw new AppError("FORBIDDEN");
  return actor.patientId;
}

// Свой разговор. Чужой ID выглядит как несуществующий.
async function ownIntake(actor: Actor, id: string) {
  const patientId = requirePatient(actor);
  const intake = await db.intake.findFirst({ where: { id, patientId } });
  if (!intake) throw new AppError("NOT_FOUND");
  return intake;
}

type CardRow = { version: number; sourceLocale: string; fields: unknown; doctorQuestions: unknown };
export const cardView = (c: CardRow | null) =>
  c && { version: c.version, sourceLocale: c.sourceLocale, fields: c.fields as CardFields, doctorQuestions: c.doctorQuestions as string[] };

const currentCard = (intakeId: string, version: number) =>
  version > 0 ? db.cardVersion.findUnique({ where: { intakeId_version: { intakeId, version } } }) : null;

const messageView = (m: { id: string; role: string; text: string; language: string }) => ({
  id: m.id, role: m.role, text: m.text, language: m.language,
});

// ---------- Создание и чтение ----------

export async function createIntake(
  actor: Actor,
  input: { locale: Locale; consentVersion: string; country?: string },
  idempotencyKey: string | null,
) {
  const patientId = requirePatient(actor);
  rateLimit(`intake:${actor.userId}`, 20, 3600);
  if (idempotencyKey) {
    const existing = await db.intake.findUnique({ where: { patientId_idempotencyKey: { patientId, idempotencyKey } } });
    if (existing) return { id: existing.id, status: existing.status };
  }
  const intake = await db.intake.create({
    data: { patientId, locale: input.locale, consentVersion: input.consentVersion, country: input.country ?? null, idempotencyKey },
  });
  return { id: intake.id, status: intake.status };
}

export async function listIntakes(actor: Actor) {
  const patientId = requirePatient(actor);
  const intakes = await db.intake.findMany({
    where: { patientId },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, processingStatus: true, urgent: true, version: true, locale: true, createdAt: true },
  });
  return { items: intakes };
}

export async function getIntake(actor: Actor, id: string) {
  const intake = await ownIntake(actor, id);
  const [messages, card, shares] = await Promise.all([
    db.message.findMany({ where: { intakeId: id }, orderBy: { createdAt: "asc" } }),
    currentCard(id, intake.version),
    db.share.findMany({ where: { intakeId: id }, orderBy: { createdAt: "desc" }, include: { doctor: true } }),
  ]);
  return {
    id: intake.id,
    status: intake.status,
    processingStatus: intake.processingStatus,
    urgent: intake.urgent,
    urgentReason: intake.urgentReason,
    locale: intake.locale,
    country: intake.country,
    version: intake.version,
    createdAt: intake.createdAt,
    messages: messages.map(messageView),
    card: cardView(card),
    preview: intake.status === "IN_PROGRESS" ? intake.preview : {},
    shares: shares.map((s) => ({
      shareId: s.id, doctorId: s.doctorId, doctorName: s.doctor.displayName,
      cardVersion: s.cardVersion, sharedAt: s.createdAt, reviewedAt: s.reviewedAt,
    })),
  };
}

// ---------- Текстовый диалог ----------

export async function addMessage(ports: Ports, actor: Actor, id: string, input: { message: string; clientMessageId: string }) {
  const intake = await ownIntake(actor, id);
  if (intake.status !== "IN_PROGRESS") throw new AppError("INTAKE_CLOSED");
  rateLimit(`msg:${actor.userId}`, 30, 60);
  const locale = isLocale(intake.locale) ? intake.locale : "ru";

  // Повтор запроса с тем же clientMessageId не создаёт вторую реплику.
  const key = { intakeId_clientMessageId: { intakeId: id, clientMessageId: input.clientMessageId } };
  const message =
    (await db.message.findUnique({ where: key })) ??
    (await db.message.create({
      data: { intakeId: id, role: "patient", text: input.message, language: locale, clientMessageId: input.clientMessageId },
    }));

  const answered = await db.message.findFirst({ where: { intakeId: id, replyToId: message.id } });
  if (answered) {
    return { message: messageView(message), assistantMessage: messageView(answered), urgent: intake.urgent, urgentReason: intake.urgentReason };
  }

  const danger = checkSafety(message.text);
  let urgent = intake.urgent;
  let urgentReason = intake.urgentReason;
  let replyText: string;
  if (danger) {
    // Опасный сигнал: модель не спрашиваем, отвечаем заранее заготовленным текстом.
    urgent = true;
    urgentReason = urgentReason ?? danger;
    await db.intake.update({ where: { id }, data: { urgent, urgentReason } });
    replyText = SAFETY_REPLY[locale];
  } else {
    const history = await db.message.findMany({ where: { intakeId: id }, orderBy: { createdAt: "asc" }, take: 60 });
    // Если модель недоступна, реплика пациентки уже сохранена; повтор с тем же clientMessageId дозапросит ответ.
    replyText = await ports.assistant.reply(
      history.map((m) => ({ role: m.role as "patient" | "assistant", text: m.text })),
      locale,
    );
  }
  const assistantMessage = await db.message.create({
    data: { intakeId: id, role: "assistant", text: replyText, language: locale, replyToId: message.id },
  });
  return { message: messageView(message), assistantMessage: messageView(assistantMessage), urgent, urgentReason };
}

// ---------- Завершение: разговор → черновик карточки (врачу ничего не уходит) ----------

async function importVoiceTranscript(ports: Ports, intakeId: string, conversationId: string, locale: Locale) {
  const transcript = await ports.voice.getTranscript(conversationId);
  // Разговор должен быть начат нашим агентом именно для этого intake.
  if (transcript.intakeId !== intakeId) throw new AppError("FORBIDDEN");
  if (!transcript.ready) throw new AppError("TRANSCRIPT_NOT_READY");
  const start = Date.now();
  await db.$transaction([
    db.message.createMany({
      data: transcript.messages.map((m, i) => ({
        intakeId, role: m.role, text: m.text, language: locale, createdAt: new Date(start + i),
      })),
    }),
    db.intake.update({ where: { id: intakeId }, data: { voiceConversationId: conversationId } }),
  ]);
}

export async function completeIntake(ports: Ports, actor: Actor, id: string, input: { expectedVersion: number; conversationId?: string }) {
  const intake = await ownIntake(actor, id);
  const done = async () => {
    const fresh = await db.intake.findUniqueOrThrow({ where: { id } });
    return { status: fresh.status, processingStatus: fresh.processingStatus, urgent: fresh.urgent, urgentReason: fresh.urgentReason, card: cardView(await currentCard(id, fresh.version)) };
  };
  // Повторный complete возвращает уже готовый результат и ничего не пересоздаёт.
  if (intake.version > 0) return done();
  if (input.expectedVersion !== 0) throw new AppError("VERSION_CONFLICT");

  // Занимаем обработку. Зависшую дольше двух минут можно перезапустить.
  const claimed = await db.intake.updateMany({
    where: { id, version: 0, OR: [{ processingStatus: { not: "PROCESSING" } }, { updatedAt: { lt: new Date(Date.now() - 120_000) } }] },
    data: { processingStatus: "PROCESSING" },
  });
  if (claimed.count === 0) return done();

  const locale = isLocale(intake.locale) ? intake.locale : "ru";
  try {
    if (input.conversationId && !intake.voiceConversationId) {
      await importVoiceTranscript(ports, id, input.conversationId, locale);
    }
    const messages = (await db.message.findMany({ where: { intakeId: id }, orderBy: { createdAt: "asc" } })).map((m) => ({
      role: m.role as "patient" | "assistant", text: m.text,
    }));
    const said = messages.filter((m) => m.role === "patient");
    if (said.length === 0) throw new AppError("EMPTY_CONVERSATION");

    // Проверяем весь разговор ещё раз: голосовой агент мог не вызвать инструмент срочности.
    const danger = checkSafety(said.map((m) => m.text).join(" \n "));
    if (danger && !intake.urgent) {
      await db.intake.update({ where: { id }, data: { urgent: true, urgentReason: danger } });
    }

    const extracted = await ports.extractor.extract(messages, locale);
    const fields = verifyQuotes(extracted, messages);
    await db.$transaction([
      db.cardVersion.create({
        data: { intakeId: id, version: 1, sourceLocale: locale, fields: json(fields), doctorQuestions: json(extracted.doctorQuestions) },
      }),
      db.intake.update({ where: { id }, data: { status: "READY", version: 1, processingStatus: "DONE" } }),
    ]);
    return done();
  } catch (e) {
    // Разговор сохранён; обработку можно повторить.
    const retriable = e instanceof AppError && (e.code === "EMPTY_CONVERSATION" || e.code === "TRANSCRIPT_NOT_READY");
    await db.intake.update({ where: { id }, data: { processingStatus: retriable ? "IDLE" : "FAILED" } });
    throw e;
  }
}

// ---------- Правка карточки: каждая правка — новая версия ----------

export async function editCard(
  actor: Actor,
  id: string,
  input: { expectedVersion: number; changes: { fields?: Partial<Record<FieldKey, string | null>>; doctorQuestions?: string[] } },
) {
  const intake = await ownIntake(actor, id);
  if (intake.version === 0) throw new AppError("CARD_NOT_READY");
  if (input.expectedVersion !== intake.version) throw new AppError("VERSION_CONFLICT");
  const card = await db.cardVersion.findUniqueOrThrow({ where: { intakeId_version: { intakeId: id, version: intake.version } } });
  const fields = structuredClone(card.fields) as CardFields;
  let changed = false;
  for (const key of FIELD_KEYS) {
    if (!(key in (input.changes.fields ?? {}))) continue;
    const value = input.changes.fields![key]?.trim() || null;
    if (value === fields[key].value) continue;
    // Текст, исправленный женщиной, помечается как изменённый и перестаёт считаться подтверждённой цитатой.
    fields[key] = { value, quote: value === null ? null : fields[key].quote, quoteVerified: false, editedByPatient: true };
    changed = true;
  }
  const doctorQuestions = input.changes.doctorQuestions?.map((q) => q.trim()).filter(Boolean) ?? (card.doctorQuestions as string[]);
  if (input.changes.doctorQuestions) changed = true;
  if (!changed) return { card: cardView(card) };

  const next = intake.version + 1;
  const created = await db.$transaction(async (tx) => {
    // Если версия уже ушла вперёд из-за параллельной правки — 409.
    const bumped = await tx.intake.updateMany({ where: { id, version: intake.version }, data: { version: next } });
    if (bumped.count === 0) throw new AppError("VERSION_CONFLICT");
    return tx.cardVersion.create({
      data: { intakeId: id, version: next, sourceLocale: card.sourceLocale, fields: json(fields), doctorQuestions: json(doctorQuestions) },
    });
  });
  // Переводы привязаны к номеру версии, поэтому для новой версии их просто ещё нет.
  return { card: cardView(created) };
}

// ---------- Отправка врачу: отдельное согласие, конкретная версия ----------

export async function shareIntake(ports: Ports, actor: Actor, id: string, input: { cardVersion: number; doctorId: string }) {
  const intake = await ownIntake(actor, id);
  if (intake.version === 0) throw new AppError("CARD_NOT_READY");

  const existing = await db.share.findUnique({
    where: { intakeId_cardVersion_doctorId: { intakeId: id, cardVersion: input.cardVersion, doctorId: input.doctorId } },
  });
  // Повторная отправка той же версии тому же врачу — тот же результат, без дубля и без второго уведомления.
  if (existing) return { shareId: existing.id, status: "SHARED" as const, cardVersion: existing.cardVersion, notification: existing.notification };

  if (input.cardVersion !== intake.version) throw new AppError("VERSION_CONFLICT");
  // Отправить можно только врачу, который связан с этой пациенткой.
  const link = await db.doctorPatient.findFirst({ where: { doctorId: input.doctorId, patientId: intake.patientId, active: true } });
  if (!link) throw new AppError("FORBIDDEN");

  let share;
  try {
    [share] = await db.$transaction([
      db.share.create({ data: { intakeId: id, cardVersion: input.cardVersion, doctorId: input.doctorId } }),
      db.intake.update({ where: { id }, data: { status: "SHARED" } }),
    ]);
  } catch {
    // Два одновременных запроса: второй упирается в уникальность и получает уже созданную отправку.
    const raced = await db.share.findUniqueOrThrow({
      where: { intakeId_cardVersion_doctorId: { intakeId: id, cardVersion: input.cardVersion, doctorId: input.doctorId } },
    });
    return { shareId: raced.id, status: "SHARED" as const, cardVersion: raced.cardVersion, notification: raced.notification };
  }

  // Уведомление — после записи отправки. Его сбой не отменяет отправку.
  let notification = "FAILED";
  try {
    notification = await ports.notifier.notifyNewShare(share.id, intake.urgent);
  } catch (e) {
    console.error("notify:", e instanceof Error ? e.message : e);
  }
  await db.share.update({ where: { id: share.id }, data: { notification } });
  return { shareId: share.id, status: "SHARED" as const, cardVersion: share.cardVersion, notification };
}

// ---------- Удаление ----------

export async function deleteIntake(ports: Ports, actor: Actor, id: string) {
  const intake = await ownIntake(actor, id);
  let voiceCopy: "NONE" | "DELETED" | "NOT_DELETED" = "NONE";
  if (intake.voiceConversationId) {
    voiceCopy = (await ports.voice.deleteConversation(intake.voiceConversationId)) ? "DELETED" : "NOT_DELETED";
  }
  // Каскадно удаляются реплики, все версии карточки, переводы и отправки: врач её больше не увидит.
  await db.intake.delete({ where: { id } });
  return {
    deleted: true,
    // Честно сообщаем, что осталось вне нашей базы.
    exceptions: {
      voiceProviderCopy: voiceCopy,
      llmProvider: "Текст разговора передавался поставщику языковой модели для обработки; срок хранения у него определяется его политикой.",
    },
  };
}

// ---------- Перевод карточки ----------

export async function translateCard(ports: Ports, actor: Actor, id: string, input: { targetLocale: Locale }) {
  let version: number;
  if (actor.role === "PATIENT") {
    version = (await ownIntake(actor, id)).version;
  } else if (actor.role === "DOCTOR" && actor.doctorId) {
    // Врач переводит только ту версию, которую ему отправили.
    const share = await db.share.findFirst({
      where: { intakeId: id, doctorId: actor.doctorId, intake: { patient: { doctors: { some: { doctorId: actor.doctorId, active: true } } } } },
      orderBy: { cardVersion: "desc" },
    });
    if (!share) throw new AppError("NOT_FOUND");
    version = share.cardVersion;
  } else {
    throw new AppError("FORBIDDEN");
  }
  if (version === 0) throw new AppError("CARD_NOT_READY");
  const card = await db.cardVersion.findUniqueOrThrow({ where: { intakeId_version: { intakeId: id, version } } });
  if (card.sourceLocale === input.targetLocale) throw new AppError("INVALID_INPUT");

  const where = { intakeId_cardVersion_locale: { intakeId: id, cardVersion: version, locale: input.targetLocale } };
  let translation = await db.cardTranslation.findUnique({ where });
  if (!translation) {
    rateLimit(`translate:${actor.userId}`, 20, 3600);
    const result = await ports.translator.translate(
      { fields: card.fields as CardFields, doctorQuestions: card.doctorQuestions as string[] },
      card.sourceLocale as Locale,
      input.targetLocale,
    );
    translation = await db.cardTranslation.upsert({
      where,
      update: {},
      create: { intakeId: id, cardVersion: version, locale: input.targetLocale, fields: json(result.fields), doctorQuestions: json(result.doctorQuestions) },
    });
  }
  return {
    cardVersion: version,
    sourceLocale: card.sourceLocale,
    locale: translation.locale,
    // Перевод всегда помечен и никогда не выдаётся за дословную цитату: оригинальные цитаты остаются в самой карточке.
    machineTranslated: translation.machine,
    fields: translation.fields,
    doctorQuestions: translation.doctorQuestions,
  };
}
