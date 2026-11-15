import { AppError } from "@/domain/errors";
import { isLocale, type Locale, type Role } from "@/domain/types";
import { db } from "@/infrastructure/db";
import { rateLimit, resetLimit } from "@/infrastructure/rate-limit";
import { checkPassword, DUMMY_HASH, hashPassword, hashToken, newToken } from "@/infrastructure/security";

// Кто делает запрос. Роль, клиника и профиль всегда берутся из сессии на сервере,
// а не из тела запроса.
export type Actor = {
  userId: string;
  role: Role;
  locale: Locale;
  patientId: string | null;
  doctorId: string | null;
  clinicId: string | null;
};

const SESSION_HOURS = () => Number(process.env.SESSION_TTL_HOURS ?? 168);
export const normalizeLogin = (login: string) => login.trim().toLowerCase();

async function startSession(userId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS() * 3600_000);
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

export async function login(input: { login: string; password: string }, ip: string) {
  const name = normalizeLogin(input.login);
  rateLimit(`login-ip:${ip}`, 100, 900); // с запасом: в клинике много людей за одним адресом
  rateLimit(`login:${name}`, 5, 900);
  const user = await db.user.findUnique({ where: { login: name } });
  const ok = await checkPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  // Один и тот же ответ на неверный логин, неверный пароль и отключённый аккаунт.
  if (!user || !ok || user.status !== "ACTIVE") throw new AppError("INVALID_CREDENTIALS");
  resetLimit(`login:${name}`);
  const session = await startSession(user.id);
  return { ...session, user: { id: user.id, role: user.role, locale: user.locale } };
}

export async function logout(token: string | null) {
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function resolveSession(token: string): Promise<Actor | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { patient: true, doctor: true } } },
  });
  if (!session || session.expiresAt < new Date() || session.user.status !== "ACTIVE") return null;
  const { user } = session;
  return {
    userId: user.id,
    role: user.role,
    locale: isLocale(user.locale) ? user.locale : "ru",
    patientId: user.patient?.status === "ACTIVE" ? user.patient.id : null,
    doctorId: user.doctor?.id ?? null,
    clinicId: user.doctor?.clinicId ?? user.patient?.clinicId ?? null,
  };
}

export async function me(actor: Actor) {
  const user = { id: actor.userId, role: actor.role, locale: actor.locale };
  if (actor.role === "PATIENT" && actor.patientId) {
    const patient = await db.patientProfile.findUniqueOrThrow({
      where: { id: actor.patientId },
      include: {
        clinic: true,
        doctors: { where: { active: true }, include: { doctor: true } },
      },
    });
    return {
      user,
      patient: { id: patient.id, displayName: patient.displayName, clinic: patient.clinic.name },
      // Кому можно отправить карточку: только врачи, связанные с этой пациенткой.
      doctors: patient.doctors.map((l) => ({ id: l.doctor.id, displayName: l.doctor.displayName, clinic: patient.clinic.name })),
    };
  }
  if (actor.role === "DOCTOR" && actor.doctorId) {
    const doctor = await db.doctorProfile.findUniqueOrThrow({ where: { id: actor.doctorId }, include: { clinic: true } });
    return { user, doctor: { id: doctor.id, displayName: doctor.displayName, clinic: doctor.clinic.name } };
  }
  return { user };
}

export async function setLocale(actor: Actor, locale: Locale) {
  await db.user.update({ where: { id: actor.userId }, data: { locale } });
  return { locale };
}

// Пациентка открывает приглашение и сама задаёт логин и пароль.
// Повторное приглашение для уже активной пациентки работает как восстановление доступа:
// пароль меняется, все старые сессии отзываются.
export async function acceptInvitation(input: { token: string; login: string; password: string }, ip: string) {
  rateLimit(`invite-ip:${ip}`, 20, 900);
  const name = normalizeLogin(input.login);
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { patient: true },
  });
  if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt < new Date() || invitation.patient.status === "ARCHIVED") {
    throw new AppError("INVITATION_INVALID");
  }
  const { patient } = invitation;
  const taken = await db.user.findUnique({ where: { login: name } });
  if (taken && taken.id !== patient.userId) throw new AppError("LOGIN_TAKEN");
  const passwordHash = await hashPassword(input.password);

  const userId = await db.$transaction(async (tx) => {
    // Одноразовость: если приглашение уже использовали параллельным запросом, здесь будет 0 строк.
    const used = await tx.invitation.updateMany({ where: { id: invitation.id, status: "PENDING" }, data: { status: "ACCEPTED" } });
    if (used.count === 0) throw new AppError("INVITATION_INVALID");
    let id = patient.userId;
    if (id) {
      await tx.user.update({ where: { id }, data: { login: name, passwordHash, status: "ACTIVE" } });
      await tx.session.deleteMany({ where: { userId: id } });
    } else {
      id = (await tx.user.create({ data: { login: name, passwordHash, role: "PATIENT", locale: patient.locale } })).id;
    }
    await tx.patientProfile.update({ where: { id: patient.id }, data: { userId: id, status: "ACTIVE" } });
    await tx.invitation.updateMany({ where: { patientId: patient.id, status: "PENDING" }, data: { status: "REVOKED" } });
    return id;
  });

  const session = await startSession(userId);
  return { ...session, user: { id: userId, role: "PATIENT" as Role, locale: patient.locale } };
}

// Ответ одинаковый независимо от того, есть ли такой аккаунт.
// Канал доставки ссылки (почта, SMS) в MVP не настроен: доступ восстанавливается
// повторным приглашением от врача. До запуска с реальными пользователями это нужно доделать.
export async function requestPasswordReset(input: { login: string }, ip: string) {
  rateLimit(`reset-ip:${ip}`, 10, 900);
  void input;
  return { accepted: true };
}
