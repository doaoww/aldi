import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

// Демоданные. Все люди, клиники и жалобы вымышлены.
const db = new PrismaClient();

const field = (value: string | null, quote: string | null = value) => ({
  value, quote, quoteVerified: value !== null, editedByPatient: false,
});

const demoCard = (o: { since: string; complaint: string; quote: string; triggers?: string; frequency?: string }) =>
  ({
    time_since_birth: field(o.since),
    birth_info: field(null),
    complaint: field(o.complaint, o.quote),
    triggers: field(o.triggers ?? null),
    frequency: field(o.frequency ?? null),
    impact: field(null),
    tried_or_told: field("к врачу не обращалась", "думала, само пройдёт"),
    own_question: field("можно ли это исправить", "можно ли это вообще исправить"),
  }) as Prisma.InputJsonValue;

async function user(login: string, role: "PATIENT" | "DOCTOR" | "ADMIN", passwordHash: string) {
  return db.user.upsert({ where: { login }, update: { passwordHash }, create: { login, role, passwordHash } });
}

async function main() {
  const password = process.env.SEED_PASSWORD ?? "aldi-demo-2026";
  const passwordHash = await bcrypt.hash(password, 10);

  const clinicA = await db.clinic.upsert({ where: { id: "demo-clinic-a" }, update: {}, create: { id: "demo-clinic-a", name: "Клиника «Демо» (вымышленная)" } });
  const clinicB = await db.clinic.upsert({ where: { id: "demo-clinic-b" }, update: {}, create: { id: "demo-clinic-b", name: "Другая клиника (вымышленная)" } });

  await user("admin.demo", "ADMIN", passwordHash);
  const doctorUser = await user("doctor.demo", "DOCTOR", passwordHash);
  const doctor2User = await user("doctor2.demo", "DOCTOR", passwordHash);
  const momUser = await user("mama.demo", "PATIENT", passwordHash);

  const doctor = await db.doctorProfile.upsert({
    where: { userId: doctorUser.id }, update: {},
    create: { userId: doctorUser.id, clinicId: clinicA.id, displayName: "Доктор Ахметова (демо)" },
  });
  // Врач другой клиники — чтобы проверять, что чужие карточки ему не видны.
  await db.doctorProfile.upsert({
    where: { userId: doctor2User.id }, update: {},
    create: { userId: doctor2User.id, clinicId: clinicB.id, displayName: "Доктор Ким (демо)" },
  });
  const mom = await db.patientProfile.upsert({
    where: { userId: momUser.id }, update: {},
    create: { userId: momUser.id, clinicId: clinicA.id, displayName: "Айгерим (демо)", status: "ACTIVE" },
  });
  await db.doctorPatient.upsert({
    where: { doctorId_patientId: { doctorId: doctor.id, patientId: mom.id } }, update: {},
    create: { doctorId: doctor.id, patientId: mom.id },
  });

  // Две отправленные карточки, одна из них с отметкой срочности.
  await db.intake.deleteMany({ where: { patientId: mom.id, consentVersion: "demo" } });
  const demos = [
    { urgent: false, card: demoCard({ since: "около 6 месяцев", complaint: "подтекание мочи", quote: "подтекает", triggers: "когда чихаю или поднимаю сына", frequency: "почти каждый день" }) },
    { urgent: true, card: demoCard({ since: "2 недели", complaint: "сильное кровотечение", quote: "прокладка промокает за час" }) },
  ];
  for (const d of demos) {
    const intake = await db.intake.create({
      data: {
        patientId: mom.id, locale: "ru", country: "KZ", consentVersion: "demo", status: "SHARED", processingStatus: "DONE",
        version: 1, urgent: d.urgent, urgentReason: d.urgent ? "bleeding" : null,
      },
    });
    await db.cardVersion.create({
      data: { intakeId: intake.id, version: 1, sourceLocale: "ru", fields: d.card, doctorQuestions: ["К какому специалисту мне с этим идти?", "Пройдёт ли это само?"] },
    });
    await db.share.create({ data: { intakeId: intake.id, cardVersion: 1, doctorId: doctor.id, notification: "SKIPPED" } });
  }

  // Упражнения. Тексты — демонстрационные заглушки (reviewed: false), а не медицинская рекомендация.
  // Настоящие упражнения, инструкции и тайминги дыхания выбирает и проверяет специалист.
  await db.exercise.upsert({
    where: { id: "breathing" }, update: {},
    create: { id: "breathing", modelUrl: "/models/breathing.glb", animationName: "Breathing", durationSec: 40, sortOrder: 1, published: true },
  });
  await db.exercise.upsert({
    where: { id: "exercise-2" }, update: {},
    create: { id: "exercise-2", modelUrl: null, animationName: null, durationSec: 60, sortOrder: 2, published: true },
  });
  const cues = (inhale: string, exhale: string) =>
    [0, 10, 20, 30].flatMap((t) => [{ atSec: t, text: inhale }, { atSec: t + 4, text: exhale }]);
  const translations = [
    { exerciseId: "breathing", locale: "ru", title: "Спокойное дыхание", description: "Демонстрация: движение и дыхание в спокойном темпе.", instructions: ["Сядьте или лягте удобно.", "Дышите в спокойном темпе, следуя подсказкам на экране."], breathingCues: cues("Вдох", "Выдох") },
    { exerciseId: "breathing", locale: "en", title: "Calm breathing", description: "Demonstration: movement and breathing at a calm pace.", instructions: ["Sit or lie down comfortably.", "Breathe at a calm pace, following the cues on the screen."], breathingCues: cues("Breathe in", "Breathe out") },
    { exerciseId: "exercise-2", locale: "ru", title: "Упражнение 2", description: "Готовится. 3D-модели пока нет.", instructions: [], breathingCues: [] },
  ];
  for (const t of translations) {
    await db.exerciseTranslation.upsert({
      where: { exerciseId_locale: { exerciseId: t.exerciseId, locale: t.locale } },
      update: {},
      create: { ...t, reviewed: false, published: true },
    });
  }

  console.log(`Готово. Логины: admin.demo, doctor.demo, doctor2.demo (другая клиника), mama.demo. Пароль: ${password}`);
}

main().finally(() => db.$disconnect());
