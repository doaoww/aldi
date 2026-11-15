// Локальный Postgres без Docker — для разработки и тестов.
// Запуск: npm run db:dev   (работает, пока открыт терминал)
// Адрес:  postgresql://aldi:aldi@localhost:54329/aldi
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const dir = process.env.DEV_DB_DIR ?? ".pgdata";
const fresh = !existsSync(dir);
const pg = new EmbeddedPostgres({
  databaseDir: dir, user: "aldi", password: "aldi", port: 54329, persistent: true,
  // Без этого на Windows база создаётся в WIN1252 и не принимает кириллицу.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("aldi");
console.log("DEV_DB_READY postgresql://aldi:aldi@localhost:54329/aldi");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
