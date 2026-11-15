import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Аккаунт врача создаёт администратор — самостоятельной регистрации врача нет.
// Запуск: npm run create-doctor -- <логин> <пароль> "<имя врача>" "<название клиники>"
const [login, password, displayName, clinicName] = process.argv.slice(2);
if (!login || !password || password.length < 8 || !displayName || !clinicName) {
  console.error('Нужно: npm run create-doctor -- <логин> <пароль от 8 символов> "<имя врача>" "<название клиники>"');
  process.exit(1);
}

const db = new PrismaClient();
try {
  const clinic =
    (await db.clinic.findFirst({ where: { name: clinicName } })) ?? (await db.clinic.create({ data: { name: clinicName } }));
  const user = await db.user.create({
    data: {
      login: login.trim().toLowerCase(),
      role: "DOCTOR",
      passwordHash: await bcrypt.hash(password, 10),
      doctor: { create: { clinicId: clinic.id, displayName } },
    },
  });
  console.log(`Врач создан: ${user.login}, клиника: ${clinic.name}`);
} catch (e) {
  console.error("Не удалось создать врача (возможно, логин занят):", e instanceof Error ? e.message.split("\n").pop() : e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
