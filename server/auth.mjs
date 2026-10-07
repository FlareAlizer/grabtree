// Доступ: кодовое слово семьи, код хранителя древа и подписанные cookie.
import { createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './http.mjs';

const SESSION = 'gt_session';            // вход: действует, пока не сменили коды и не вышел срок
const DEVICE = 'gt_device';              // устройство: переживает выход и новый вход
const SESSION_AGE = 180 * 24 * 3600;     // сессия живёт полгода
const DEVICE_AGE = 3 * 365 * 24 * 3600;
const WINDOW = 15 * 60 * 1000;           // окно для подсчёта неверных попыток
const MAX_FAILS = 8;
const MIN_CODE = 8;

// Кодовые слова собираются из названий деревьев латиницей — их можно набрать с любой клавиатуры.
const WORDS = ['dub', 'klen', 'lipa', 'yasen', 'bereza', 'sosna', 'kedr', 'ryabina', 'iva', 'topol', 'vyaz', 'buk', 'grab',
  'kashtan', 'oreh', 'vishnya', 'yablonya', 'grusha', 'sliva', 'siren', 'olha', 'osina', 'kalina', 'pihta', 'kiparis',
  'oliva', 'limon', 'palma', 'akatsiya', 'cheremuha', 'listvennitsa', 'mozhzhevelnik'];

const makeCode = (words, digits) => [
  ...Array.from({ length: words }, () => WORDS[randomInt(WORDS.length)]),
  String(randomInt(10 ** digits)).padStart(digits, '0'),
].join('-');

export const normalizeCode = (value) => String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
const digest = (text) => createHash('sha256').update(text).digest();
// Сравнение без утечки по времени; хеши одной длины, поэтому годится для любых строк.
const sameText = (a, b) => timingSafeEqual(digest(a), digest(b));

export function cleanName(value) {
  const name = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) throw new HttpError(400, 'Представьтесь, пожалуйста: имя нужно, чтобы родные видели, кто что дописал');
  if (name.length > 40) throw new HttpError(400, 'Имя слишком длинное');
  return name;
}

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// env: FAMILY_CODE и ADMIN_CODE задают коды явно; иначе они создаются при первом запуске и лежат в access.json.
// proxyHops — сколько своих прокси стоит перед сервером (0 — ни одного).
export async function openAuth(dir, env = {}, { proxyHops = 0 } = {}) {
  const accessFile = join(dir, 'access.json');
  const saved = JSON.parse((await readOptional(accessFile)) || '{}');
  const codes = { family: normalizeCode(env.FAMILY_CODE || saved.familyCode), admin: normalizeCode(env.ADMIN_CODE || saved.adminCode) };
  const created = !codes.family || !codes.admin;
  if (!codes.family) codes.family = makeCode(4, 2);
  if (!codes.admin) codes.admin = makeCode(5, 3);
  if (codes.family.length < MIN_CODE || codes.admin.length < MIN_CODE) throw new Error(`Кодовые слова должны быть не короче ${MIN_CODE} символов`);
  if (codes.family === codes.admin) throw new Error('Кодовое слово семьи и код хранителя должны различаться');
  // файлы с секретами читает только владелец (на Windows режим не действует)
  if (created) await writeFile(accessFile, JSON.stringify({ familyCode: codes.family, adminCode: codes.admin }, null, 2), { mode: 0o600 });

  const secretFile = join(dir, 'secret.key');
  let secret = await readOptional(secretFile);
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    await writeFile(secretFile, secret, { mode: 0o600 });
  }
  // Смена любого кода делает прежние сессии недействительными.
  const generation = digest(`${codes.family}|${codes.admin}`).toString('hex').slice(0, 12);

  // ── Подписанные значения cookie ──────────────────────────
  const mac = (body) => createHmac('sha256', secret).update(body).digest('base64url');
  const seal = (payload) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${mac(body)}`;
  };
  function unseal(token) {
    const [body, signature] = String(token || '').split('.');
    if (!body || !signature || !sameText(signature, mac(body))) return null;
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }
  const cookie = (req, name) => String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || '';

  const isHttps = (req) => Boolean(req.socket.encrypted) || (proxyHops > 0 && req.headers['x-forwarded-proto'] === 'https');
  const attrs = (req, maxAge) => `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;

  // Адрес посетителя. За прокси — тот, что дописал наш прокси: в X-Forwarded-For это последние записи,
  // а всё, что левее, прислал сам посетитель и доверять этому нельзя.
  function clientIp(req) {
    if (proxyHops > 0) {
      const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean);
      const ip = chain[chain.length - proxyHops];
      if (ip) return ip;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  function user(req) {
    const p = unseal(cookie(req, SESSION));
    if (!p || p.g !== generation || Date.now() - p.t >= SESSION_AGE * 1000) return null;
    return { uid: p.u, name: p.n, admin: p.a === 1 };
  }

  // Вместе с сессией выдаётся метка устройства. По ней человек остаётся собой после выхода,
  // истечения сессии или смены кодов: его записи и сердечки по-прежнему его.
  function issue(req, res, who) {
    res.setHeader('set-cookie', [
      `${SESSION}=${seal({ u: who.uid, n: who.name, a: who.admin ? 1 : 0, g: generation, t: Date.now() })}${attrs(req, SESSION_AGE)}`,
      `${DEVICE}=${seal({ u: who.uid })}${attrs(req, DEVICE_AGE)}`,
    ]);
    return who;
  }

  // Защита от подбора: не больше MAX_FAILS неверных кодов с одного адреса за WINDOW.
  // Удачный вход счётчик не сбрасывает — иначе, зная слово семьи, можно без ограничений подбирать код хранителя.
  const attempts = new Map();
  function noteFailure(ip) {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
    const entry = attempts.get(ip);
    if (entry) entry.fails++;
    else attempts.set(ip, { fails: 1, until: now + WINDOW });
  }

  function login(req, res, { name, code }) {
    const ip = clientIp(req);
    const entry = attempts.get(ip);
    if (entry && entry.until > Date.now() && entry.fails >= MAX_FAILS) throw new HttpError(429, 'Слишком много попыток. Попробуйте через 15 минут.');

    const typed = normalizeCode(code);
    const admin = sameText(typed, codes.admin);
    if (!admin && !sameText(typed, codes.family)) {
      noteFailure(ip);
      throw new HttpError(401, 'Кодовое слово не подошло. Проверьте его или попросите у родных ссылку-приглашение.');
    }
    const uid = user(req)?.uid || unseal(cookie(req, DEVICE))?.u || randomBytes(8).toString('hex');
    return issue(req, res, { uid: String(uid), name: cleanName(name), admin });
  }

  return {
    codes,
    created,
    user,
    login,
    rename: (req, res, current, name) => issue(req, res, { ...current, name: cleanName(name) }),
    // выход снимает только сессию; метка устройства остаётся
    logout: (req, res) => res.setHeader('set-cookie', `${SESSION}=${attrs(req, 0)}`),
  };
}
