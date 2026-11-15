// Быстрая проверка на настоящих ключах: вход → разговор → карточка → голосовой сеанс.
// Запуск: node scripts/smoke.mjs [адрес сервера]   (нужны демо-аккаунты из сида)
const BASE = process.argv[2] ?? "http://localhost:3987";
const ORIGIN = process.env.SMOKE_ORIGIN ?? "http://app.test";
let cookie = "";

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.error?.code}`);
  return json.data;
}

await call("POST", "/api/auth/login", { login: "mama.demo", password: process.env.SEED_PASSWORD ?? "aldi-demo-2026" });
const { id } = await call("POST", "/api/intakes", { locale: "ru", consentVersion: "smoke", consent: true, country: "KZ" });

const said = [
  "Я родила полгода назад. Когда чихаю или поднимаю сына — подтекает.",
  "Почти каждый день. Врачу не говорила, думала, само пройдёт.",
];
for (const [i, message] of said.entries()) {
  const r = await call("POST", `/api/intakes/${id}/messages`, { message, clientMessageId: `smoke-${i}` });
  console.log(`\nПациентка: ${message}\nAldi:      ${r.assistantMessage.text.trim()}`);
}

const done = await call("POST", `/api/intakes/${id}/complete`, { expectedVersion: 0 });
console.log(`\nКарточка (статус ${done.status}):`);
for (const [key, f] of Object.entries(done.card.fields)) {
  console.log(`  ${key.padEnd(17)} ${f.value ?? "—"}${f.value ? `  [цитата: «${f.quote}» ${f.quoteVerified ? "подтверждена" : "НЕ подтверждена"}]` : ""}`);
}
console.log("  вопросы врачу:   ", done.card.doctorQuestions.join(" | "));

try {
  const voiceIntake = await call("POST", "/api/intakes", { locale: "ru", consentVersion: "smoke", consent: true });
  const voice = await call("POST", "/api/voice/session", { intakeId: voiceIntake.id });
  console.log(`\nГолос: сеанс получен (${new URL(voice.sessionUrl).host}), переменные: ${Object.keys(voice.dynamicVariables).join(", ")}`);
  await call("DELETE", `/api/intakes/${voiceIntake.id}`);
} catch (e) {
  console.log(`\nГолос: ОШИБКА — ${e.message}`);
}
await call("DELETE", `/api/intakes/${id}`);
console.log("\nТестовые разговоры удалены.");
