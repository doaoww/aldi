import { NextResponse, type NextRequest } from "next/server";

// CORS: точный список разрешённых сайтов из CORS_ORIGINS, с поддержкой cookie-сессий.
export function proxy(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "";
  const allowed = (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const headers: Record<string, string> = allowed.includes(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, Accept-Language",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      }
    : {};
  if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: "/api/:path*" };
