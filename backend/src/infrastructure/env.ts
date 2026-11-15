// Переменные читаем в момент использования: сборка не падает без секретов,
// а запрос, которому не хватает настройки, получает понятную ошибку в логе.
export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

export const optionalEnv = (name: string): string | undefined => process.env[name] || undefined;

export const allowedOrigins = (): string[] =>
  (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export const isProd = () => process.env.NODE_ENV === "production";
