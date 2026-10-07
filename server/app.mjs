// Приложение: раздаёт сайт из publicDir и отвечает на запросы /api/*.
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { openDb, PHOTO_URL } from './db.mjs';
import { openAuth } from './auth.mjs';
import { HttpError, readBody, readJson, sendJson, sendFile, resolveInside } from './http.mjs';

const PHOTO_LIMIT = 6 * 1024 * 1024;
const UPLOADS_PER_HOUR = 120;
const UPLOADS_TOTAL_MB = 5000; // потолок на все фотографии вместе, если не задан UPLOADS_LIMIT_MB
const ID = '[\\w-]{1,32}';
const PERSON_ROUTE = new RegExp(`^/api/people/(${ID})(?:/memories(?:/(${ID})(/heart)?)?)?$`);

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

// Тип картинки определяется по первым байтам, а не по тому, что прислал браузер.
function sniffImage(body) {
  if (body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'jpg';
  if (body.length > 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (body.length > 12 && body.toString('latin1', 0, 4) === 'RIFF' && body.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

async function folderBytes(dir) {
  let total = 0;
  for (const name of await readdir(dir)) total += (await stat(join(dir, name))).size;
  return total;
}

// config: { dataDir, publicDir, env?, proxyHops? } → { handle(req, res), close(), codes, codesCreated }
// proxyHops — сколько своих обратных прокси стоит перед сервером (0 — сервер открыт напрямую).
export async function createApp({ dataDir, publicDir, env = {}, proxyHops = 0 }) {
  const data = resolve(dataDir);
  const pub = resolve(publicDir);
  const uploadsDir = join(data, 'uploads');
  await mkdir(data, { recursive: true, mode: 0o700 });
  const db = await openDb(data);
  const auth = await openAuth(data, env, { proxyHops });

  // Название древа из настроек установки применяется один раз — когда базы ещё нет.
  // Дальше им распоряжается хранитель, в том числе может оставить пустым.
  if (db.isNew && env.FAMILY_SURNAME) {
    await db.setFamily({ uid: 'setup', name: 'setup', admin: true }, { surname: env.FAMILY_SURNAME });
  }

  const uploadMarks = new Map(); // uid → отметки времени недавних загрузок
  const uploadsLimit = (Number(env.UPLOADS_LIMIT_MB) || UPLOADS_TOTAL_MB) * 1024 * 1024;
  let uploadsBytes = await folderBytes(uploadsDir);

  const state = (user, extra = {}) => ({
    ...db.view(user),
    me: { name: user.name, admin: user.admin },
    inviteCode: auth.codes.family,
    ...extra,
  });

  // Запросы, которые что-то меняют, принимаются только со своего сайта.
  function checkOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return;
    const allowed = [req.headers.host, proxyHops > 0 && req.headers['x-forwarded-host']].filter(Boolean);
    let host = null;
    try {
      host = new URL(origin).host;
    } catch { /* host остаётся пустым */ }
    if (!allowed.includes(host)) throw new HttpError(403, 'Запрос с чужого сайта отклонён');
  }

  async function savePhoto(req, user) {
    // Отметка ставится до чтения файла: иначе пачка одновременных загрузок вся проходит проверку.
    const now = Date.now();
    const recent = (uploadMarks.get(user.uid) || []).filter((at) => now - at < 3600 * 1000);
    if (recent.length >= UPLOADS_PER_HOUR) throw new HttpError(429, 'Слишком много фотографий за час. Продолжите чуть позже.');
    uploadMarks.set(user.uid, [...recent, now]);

    const body = await readBody(req, PHOTO_LIMIT);
    const ext = sniffImage(body);
    if (!ext) throw new HttpError(415, 'Это не похоже на фотографию. Подойдут JPEG, PNG и WebP.');
    if (uploadsBytes + body.length > uploadsLimit) throw new HttpError(507, 'Место под фотографии закончилось. Напишите хранителю древа.');
    uploadsBytes += body.length;
    const name = `${randomBytes(8).toString('hex')}.${ext}`;
    await writeFile(join(uploadsDir, name), body);
    db.journal(user, 'upload', { file: name, bytes: body.length });
    return `/uploads/${name}`;
  }

  async function api(req, res, path, url) {
    const method = req.method;
    if (method !== 'GET') checkOrigin(req);
    const user = auth.user(req);
    const route = `${method} ${path}`;
    const reply = (data, status = 200) => sendJson(req, res, status, data);

    if (route === 'GET /api/session') {
      return reply({ authorized: Boolean(user), name: user?.name || '', admin: Boolean(user?.admin), surname: db.family.surname });
    }
    if (route === 'POST /api/login') return reply(state(auth.login(req, res, await readJson(req))));
    if (route === 'POST /api/logout') {
      auth.logout(req, res);
      return reply({ ok: true });
    }
    if (!user) throw new HttpError(401, 'Нужно войти: введите кодовое слово семьи');

    if (route === 'GET /api/state') {
      if (Number(url.searchParams.get('v')) === db.version) return reply({ version: db.version, unchanged: true });
      return reply(state(user));
    }
    if (route === 'POST /api/name') return reply(state(auth.rename(req, res, user, (await readJson(req)).name)));
    if (route === 'POST /api/photos') return reply({ url: await savePhoto(req, user) });
    if (route === 'PATCH /api/family') {
      await db.setFamily(user, await readJson(req));
      return reply(state(user));
    }
    if (route === 'GET /api/export') {
      if (!user.admin) throw new HttpError(403, 'Резервную копию скачивает только хранитель древа');
      return sendJson(req, res, 200, db.raw, { 'content-disposition': `attachment; filename="grabtree-${new Date().toISOString().slice(0, 10)}.json"` });
    }
    if (route === 'POST /api/people') {
      const createdId = await db.addPerson(user, await readJson(req));
      return reply(state(user, { createdId }));
    }

    const [, personId, memoryId, heart] = path.match(PERSON_ROUTE) || [];
    if (personId && !memoryId && !path.endsWith('/memories')) {
      if (method === 'PATCH') await db.updatePerson(user, personId, await readJson(req));
      else if (method === 'DELETE') await db.removePerson(user, personId);
      else throw new HttpError(405, 'Так нельзя');
      return reply(state(user));
    }
    if (personId && !memoryId && method === 'POST') {
      await db.addMemory(user, personId, await readJson(req));
      return reply(state(user));
    }
    if (personId && memoryId && heart && method === 'POST') {
      await db.toggleHeart(user, personId, memoryId);
      return reply(state(user));
    }
    if (personId && memoryId && !heart && method === 'DELETE') {
      await db.removeMemory(user, personId, memoryId);
      return reply(state(user));
    }
    throw new HttpError(404, 'Не найдено');
  }

  async function route(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    let url;
    let path;
    try {
      url = new URL(req.url, 'http://localhost');
      path = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'Неверный адрес');
    }

    if (path.startsWith('/api/')) return api(req, res, path, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Так нельзя');
    if (path.startsWith('/uploads/')) {
      // Семейные фотографии видны только тем, кто вошёл.
      if (!auth.user(req)) throw new HttpError(401, 'Нужно войти');
      if (!PHOTO_URL.test(path)) throw new HttpError(404, 'Не найдено');
      return sendFile(req, res, join(data, path), 'private, max-age=31536000, immutable');
    }
    return sendFile(req, res, resolveInside(pub, path === '/' ? '/index.html' : path), 'no-cache');
  }

  function handle(req, res) {
    return route(req, res).catch((err) => {
      const known = err instanceof HttpError;
      // посетитель оборвал запрос на полуслове — это не ошибка сервера, в журнал она не идёт
      if (err?.code === 'ECONNRESET') return res.destroy();
      if (!known) console.error(`${req.method} ${req.url}:`, err);
      if (res.headersSent) return res.destroy();
      sendJson(req, res, known ? err.status : 500, { error: known ? err.message : 'На сервере что-то пошло не так. Попробуйте ещё раз.' });
    });
  }

  return { handle, close: () => db.close(), codes: auth.codes, codesCreated: auth.created, db };
}
