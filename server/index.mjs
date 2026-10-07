// Точка входа: node server/index.mjs
// Настройки — переменные окружения или файл .env в корне проекта (образец: config/env.example).
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// .env необязателен; то, что уже задано в окружении, он не перебивает.
try {
  process.loadEnvFile(join(root, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const env = process.env;
const port = Number(env.PORT) || 3000;
const host = env.HOST || '0.0.0.0';
// Относительный путь считается от корня проекта, а не от папки, из которой запустили сервер:
// иначе запуск из другого места молча поднимет пустое древо с новыми кодами.
const dataDir = resolve(root, env.DATA_DIR || 'data');

// TRUST_PROXY — целое число своих прокси перед сервером. Опечатка здесь молча ломает защиту от подбора,
// поэтому с непонятным значением сервер не запускается.
const proxyHops = Number(env.TRUST_PROXY || 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 8) {
  console.error(`TRUST_PROXY должен быть целым числом от 0 до 8, а задано «${env.TRUST_PROXY}»`);
  process.exit(1);
}

// Без FAMILY_SURNAME древо называется просто «Семейное древо»; название потом задаёт хранитель на сайте.
const app = await createApp({ dataDir, publicDir: join(root, 'src'), env, proxyHops });

const server = createServer(app.handle);
server.listen(port, host, () => {
  console.log(`Семейное древо: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`Данные: ${dataDir}`);
  if (app.codesCreated) {
    console.log('Созданы коды доступа (они же лежат в access.json в папке данных):');
    console.log(`  кодовое слово семьи: ${app.codes.family}`);
    console.log(`  код хранителя древа: ${app.codes.admin}`);
  }
});

// Остановка: перестаём принимать запросы и дожидаемся записи на диск.
function shutdown() {
  server.close(async () => {
    await app.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
