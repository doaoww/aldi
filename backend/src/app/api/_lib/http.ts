import { z, ZodError } from "zod";
import { resolveSession, type Actor } from "@/application/auth";
import { AppError, ERROR_MESSAGES, type ErrorCode } from "@/domain/errors";
import { isLocale, LOCALES, type Locale, type Role } from "@/domain/types";
import { allowedOrigins, env, isProd } from "@/infrastructure/env";
import { safeEqual } from "@/infrastructure/security";

// Презентационный слой: проверка входа и прав, валидация, единый формат ответа.
// Успех: { data }. Ошибка: { error: { code, message } } — код стабилен, текст на языке пользователя.

export const COOKIE = "aldi_session";

export function sessionCookie(token: string | null, expiresAt?: Date): string {
  const sameSite = (process.env.COOKIE_SAMESITE ?? "lax").toLowerCase();
  const parts = [
    `${COOKIE}=${token ?? ""}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite === "none" ? "None" : sameSite === "strict" ? "Strict" : "Lax"}`,
    token && expiresAt ? `Expires=${expiresAt.toUTCString()}` : "Max-Age=0",
  ];
  if (isProd() || sameSite === "none") parts.push("Secure");
  return parts.join("; ");
}

// Ответ с дополнительными заголовками (например, Set-Cookie при входе).
export class Reply {
  constructor(public data: unknown, public headers: Record<string, string> = {}) {}
}

export const localeSchema = z.enum(LOCALES, { error: "UNSUPPORTED_LOCALE" });
export const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };

type Ctx<P> = {
  req: Request;
  params: P;
  actor: Actor; // для public-маршрутов не используется
  token: string | null;
  ip: string;
  idempotencyKey: string | null;
  body: <T>(schema: z.ZodType<T>) => Promise<T>;
  query: <T>(schema: z.ZodType<T>) => T;
};

type Access = "public" | "tool" | Role[];

function requestLocale(req: Request, actor?: Actor | null): Locale {
  if (actor) return actor.locale;
  const tag = (req.headers.get("accept-language") ?? "").split(",")[0].trim().slice(0, 2).toLowerCase();
  return isLocale(tag) ? tag : "ru";
}

function fail(code: ErrorCode, status: number, locale: Locale, details?: unknown) {
  return Response.json({ error: { code, message: ERROR_MESSAGES[locale][code], ...(details ? { details } : {}) } }, { status });
}

function readToken(req: Request): { token: string | null; fromCookie: boolean } {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (bearer) return { token: bearer, fromCookie: false };
  const cookie = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return { token: cookie || null, fromCookie: Boolean(cookie) };
}

// Защита от CSRF для cookie-сессий: изменяющий запрос должен прийти с нашего сайта.
function csrfOk(req: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  if (allowedOrigins().includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export function handle<P = Record<string, never>>(access: Access, fn: (ctx: Ctx<P>) => Promise<unknown>) {
  return async (req: Request, routeCtx: { params: Promise<P> }) => {
    let actor: Actor | null = null;
    try {
      const { token, fromCookie } = readToken(req);
      if (access === "tool") {
        // Вызовы инструментов голосового агента: общий секрет в заголовке.
        if (!safeEqual(req.headers.get("x-tool-secret") ?? "", env("TOOL_SECRET"))) throw new AppError("UNAUTHENTICATED");
      } else if (access !== "public") {
        actor = token ? await resolveSession(token) : null;
        if (!actor) throw new AppError("UNAUTHENTICATED");
        if (fromCookie && !csrfOk(req)) throw new AppError("CSRF_REJECTED");
        if (!access.includes(actor.role)) throw new AppError("FORBIDDEN");
      }

      const result = await fn({
        req,
        params: await routeCtx.params,
        actor: actor as Actor,
        token,
        ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local",
        idempotencyKey: req.headers.get("idempotency-key")?.slice(0, 200) || null,
        body: async (schema) => {
          let raw: unknown;
          try {
            raw = await req.json();
          } catch {
            throw new AppError("INVALID_INPUT");
          }
          return schema.parse(raw);
        },
        query: (schema) => schema.parse(Object.fromEntries(new URL(req.url).searchParams)),
      });

      const headers = { "Cache-Control": "no-store", ...(result instanceof Reply ? result.headers : {}) };
      return Response.json({ data: result instanceof Reply ? result.data : result }, { headers });
    } catch (e) {
      const locale = requestLocale(req, actor);
      if (e instanceof AppError) return fail(e.code, e.status, locale);
      if (e instanceof ZodError) {
        // Сообщаем, какие поля неверны, но не возвращаем сами значения.
        const custom = e.issues.find((i) => i.message === "UNSUPPORTED_LOCALE" || i.message === "CONSENT_REQUIRED");
        const code = (custom?.message as ErrorCode | undefined) ?? "INVALID_INPUT";
        return fail(code, 400, locale, e.issues.map((i) => ({ path: i.path.join("."), problem: i.code })));
      }
      // Служебные ошибки Next.js (у них есть digest) отдаём самому Next.js.
      if (e && typeof e === "object" && "digest" in e) throw e;
      // В лог — только тип и сообщение ошибки, без тел запросов, токенов и медицинского текста.
      console.error(`${req.method} ${new URL(req.url).pathname}:`, e instanceof Error ? `${e.name}: ${e.message}` : "unknown error");
      return fail("INTERNAL", 500, locale);
    }
  };
}

export type IdParams = { id: string };
