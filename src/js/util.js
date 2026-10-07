const SVG_NS = 'http://www.w3.org/2000/svg';

function build(el, attrs, kids) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...kids.flat(2).filter((k) => k != null && k !== false));
  return el;
}

// Весь DOM собирается через h()/s(): пользовательский текст попадает только в текстовые узлы.
export const h = (tag, attrs, ...kids) => build(document.createElement(tag), attrs, kids);
export const s = (tag, attrs, ...kids) => build(document.createElementNS(SVG_NS, tag), attrs, kids);

// ── Даты: «1950», «12.03.1950» или «1950-03-12» ─────────────
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function parseDate(str) {
  const text = String(str || '').trim();
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return { y: +m[3], m: +m[2], d: +m[1] };
  m = text.match(/\d{4}/);
  return m ? { y: +m[0] } : null;
}

export const yearOf = (str) => parseDate(str)?.y ?? null;

export function formatDate(str) {
  const p = parseDate(str);
  if (!p) return str || '';
  return p.d && MONTHS[p.m - 1] ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : String(p.y);
}

export function ageOf(person, at = new Date()) {
  const born = parseDate(person.born);
  const end = person.died ? parseDate(person.died) : { y: at.getFullYear(), m: at.getMonth() + 1, d: at.getDate() };
  if (!born || !end) return null;
  let age = end.y - born.y;
  if (born.m && end.m && (end.m < born.m || (end.m === born.m && (end.d || 1) < (born.d || 1)))) age--;
  return age >= 0 ? age : null;
}

export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b > 1 && b < 5) return few;
  return many;
}

export const years = (n) => `${n} ${plural(n, ['год', 'года', 'лет'])}`;

export function relTime(iso, now = Date.now()) {
  const min = Math.round((now - new Date(iso)) / 60000);
  if (min < 2) return 'только что';
  if (min < 60) return `${min} ${plural(min, ['минуту', 'минуты', 'минут'])} назад`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} ${plural(hrs, ['час', 'часа', 'часов'])} назад`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'вчера';
  if (days < 30) return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`;
  return new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'long' });
}

export function roman(n) {
  const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, r] of map) while (n >= v) { out += r; n -= v; }
  return out;
}

// ── Люди ────────────────────────────────────────────────────
export const fullName = (p) => [p.first, p.last].filter(Boolean).join(' ') || 'Без имени';

export function lifespan(p) {
  const b = yearOf(p.born);
  const d = yearOf(p.died);
  if (p.died) return `${b ?? '?'} — ${d ?? '?'}`;
  return b ? `р. ${b}` : '';
}

// Силуэт вместо фото, которого пока нет: голова и плечи, у женщин — каре.
function silhouette(gender) {
  return s('svg', { viewBox: '0 0 100 124', preserveAspectRatio: 'xMidYMax slice', 'aria-hidden': 'true' },
    gender === 'f' && s('path', { d: 'M27 50C27 27 37 17 50 17s23 10 23 33c0 7 2 12 5 16H60V52H40v14H22c3-4 5-9 5-16Z' }),
    s('ellipse', { cx: 50, cy: 46, rx: 18, ry: 22 }),
    s('path', { d: 'M41 62h18v14c0 3 2 5 6 6 16 4 27 14 27 42H8c0-28 11-38 27-42 4-1 6-3 6-6Z' }),
  );
}

// Овальный портрет в тонкой рамке — как на старых родословных.
export function portrait(p) {
  return h('span', { class: 'portrait' },
    p.photos?.[0] ? h('img', { src: p.photos[0], alt: '', draggable: 'false' }) : silhouette(p.gender),
  );
}

// ── Фото: ужимаем перед отправкой на сервер ─────────────────
// Возвращает JPEG не шире и не выше max пикселей — снимок с телефона худеет раз в десять.
export async function resizeImage(file, max = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не получилось обработать фото'))), 'image/jpeg', 0.85);
  });
}
