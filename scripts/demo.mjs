// Демо: сервер на временной папке с выдуманной семьёй — посмотреть сайт, ничего не настраивая.
// Запуск: npm run demo. Порт — переменная PORT (по умолчанию 3000). При остановке (Ctrl+C) папка стирается.
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { seedDemoFamily } from './demo-family.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;
const dataDir = await mkdtemp(join(tmpdir(), 'grabtree-demo-'));

// Коды каждый раз новые; свои можно задать через FAMILY_CODE и ADMIN_CODE.
const { FAMILY_CODE, ADMIN_CODE } = process.env;
const app = await createApp({ dataDir, publicDir: join(root, 'src'), env: { FAMILY_CODE, ADMIN_CODE } });
await seedDemoFamily(app.db);

// Демо слушает только этот компьютер: коды напечатаны в консоли, наружу его выставлять незачем.
const server = createServer(app.handle);
server.listen(port, '127.0.0.1', () => {
  console.log(`Демо-древо: http://localhost:${port}`);
  console.log(`  кодовое слово семьи: ${app.codes.family}`);
  console.log(`  код хранителя древа: ${app.codes.admin}`);
  console.log(`Данные во временной папке ${dataDir} — она исчезнет при остановке.`);
});

async function shutdown() {
  server.close();
  server.closeAllConnections();
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
