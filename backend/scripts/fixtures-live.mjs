// Прогон тестовых диалогов через настоящий сервер и настоящую модель:
// реплики мамы отправляются по одной, затем собирается карточка.
// Запуск: node scripts/fixtures-live.mjs [адрес сервера] [файл с диалогами]
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3987";
const FILE = process.argv[3] ?? "src/infrastructure/llm/four-language-dialogues.json";
const ORIGIN = process.env.SMOKE_ORIGIN ?? "http://app.test";
const ONLY = process.argv[4]?.split(","); // необязательно: список id через запятую, с подробным выводом карточки
const cases = JSON.parse(readFileSync(FILE, "utf8")).filter((c) => !ONLY || ONLY.includes(c.id));
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
  if (!res.ok) throw new Error(`${method} ${path.replace(/[0-9a-f-]{36}/, ":id")} → ${res.status} ${json.error?.code}`);
  return json.data;
}

const norm = (s) => s.toLowerCase().replace(/ё/g, "е").replace(/[’‘ʻʼ`´]/g, "'").replace(/[^\p{L}\p{N}']+/gu, " ").trim();

await call("POST", "/api/auth/login", { login: "mama.demo", password: process.env.SEED_PASSWORD ?? "aldi-demo-2026" });
const summary = [];

for (const c of cases) {
  const locale = c.language.split("-")[0];
  const row = { id: c.id, expectEscalate: c.expected_card.escalate };
  let id;
  try {
    ({ id } = await call("POST", "/api/intakes", { locale, consentVersion: "fixtures", consent: true }));
    const replies = [];
    let urgent = false;
    for (const [i, m] of c.dialogue.filter((m) => m.role === "mother").entries()) {
      const r = await call("POST", `/api/intakes/${id}/messages`, { message: m.text, clientMessageId: `${c.id}-${i}` });
      urgent = r.urgent;
      replies.push(r.assistantMessage.text.trim().replace(/\s+/g, " "));
    }
    const done = await call("POST", `/api/intakes/${id}/complete`, { expectedVersion: 0 });
    const fields = Object.values(done.card.fields);
    const want = norm(c.expected_card.quote_original);
    row.urgent = done.urgent || urgent;
    row.filled = fields.filter((f) => f.value).length;
    row.unverified = fields.filter((f) => f.value && !f.quoteVerified).length;
    // Ожидаемая цитата считается найденной, если её текст пересекается с подтверждённой цитатой карточки.
    row.quoteFound = fields.some((f) => f.quote && f.quoteVerified && (norm(f.quote).includes(want) || want.includes(norm(f.quote))));
    row.questions = done.card.doctorQuestions.length;
    row.replies = replies;
    if (ONLY) {
      console.log(`
--- ${c.id}: ждали цитату «${c.expected_card.quote_original}»`);
      for (const [k, f] of Object.entries(done.card.fields)) if (f.value) console.log(`    ${k}: ${f.value} | «${f.quote}» ${f.quoteVerified ? "✓" : "✗ НЕ подтверждена"}`);
    }
  } catch (e) {
    row.error = e.message;
  } finally {
    if (id) await call("DELETE", `/api/intakes/${id}`).catch(() => {});
  }
  summary.push(row);
  const ok = !row.error && row.urgent === row.expectEscalate && row.quoteFound;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${c.id}  срочность: ждали ${row.expectEscalate}, получили ${row.urgent}` +
      (row.error ? `  ОШИБКА ${row.error}` : `  цитата найдена: ${row.quoteFound}  полей: ${row.filled}  неподтверждённых: ${row.unverified}  вопросов: ${row.questions}`),
  );
  for (const r of row.replies ?? []) console.log(`       Aldi: ${r.slice(0, 260)}`);
  await new Promise((r) => setTimeout(r, 2500)); // не упираться в лимит сообщений в минуту
}

const passed = summary.filter((r) => !r.error && r.urgent === r.expectEscalate && r.quoteFound).length;
console.log(`\nИтог: ${passed} из ${summary.length}`);
