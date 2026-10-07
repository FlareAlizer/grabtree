import { api, ApiError } from './api.js';
import { yearOf } from './util.js';

// Древо живёт на сервере: каждое изменение уходит запросом, в ответ приходит свежая копия.
// В браузере остаются только личные настройки устройства: кто я в древе, оформление, вид.
const PREFS_KEY = 'grabtree:prefs';
const POLL_MS = 45000;

const listeners = new Set();
let prefs = { meId: null, rootId: null, theme: 'paper', flip: false, ...readPrefs() };
let data = { version: 0, family: { surname: '', elderId: null, celebration: '' }, people: [], log: [] };
let session = { authorized: false, name: '', admin: false, inviteCode: '' };
let ready = false; // первый разговор с сервером состоялся

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* настройки просто не переживут перезагрузку */ }
  notify();
}

// remote = true — изменения пришли от других родных, а не от действия на этой странице.
function notify(remote = false) {
  listeners.forEach((fn) => fn({ remote }));
}

function apply(state, remote = false) {
  if (state.unchanged) return state;
  if (!Array.isArray(state.people) || !Array.isArray(state.log) || !state.family || !state.me) {
    throw new ApiError(0, 'Сервер ответил непонятно. Обновите страницу.');
  }
  // ответ фонового опроса, опоздавший к ответу на собственное действие, не откатывает страницу назад
  if (remote && state.version < data.version) return state;
  data = { version: state.version, family: state.family, people: state.people, log: state.log };
  session = { authorized: true, name: state.me.name, admin: state.me.admin, inviteCode: state.inviteCode };
  notify(remote);
  return state;
}

async function request(method, path, body, remote = false) {
  try {
    return apply(await api(method, path, body), remote);
  } catch (err) {
    if (err.status === 401 && session.authorized) {
      // сессия закончилась или сменилось кодовое слово — возвращаемся на обложку
      session = { ...session, authorized: false };
      notify();
    }
    throw err;
  }
}

const byId = (id) => data.people.find((p) => p.id === id) || null;
const byBirth = (a, b) => (yearOf(a.born) ?? 9999) - (yearOf(b.born) ?? 9999);
const existing = (ids) => ids.map(byId).filter(Boolean);

const childrenOf = (id) => data.people.filter((p) => p.parents.includes(id)).sort(byBirth);

function descendantCount(id, seen = new Set()) {
  for (const child of childrenOf(id)) {
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    descendantCount(child.id, seen);
  }
  return seen.size;
}

function depthBelow(id, trail = new Set()) {
  if (trail.has(id)) return 0;
  trail.add(id);
  const depth = 1 + Math.max(0, ...childrenOf(id).map((c) => depthBelow(c.id, trail)));
  trail.delete(id);
  return depth;
}

export const store = {
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  get people() { return data.people; },
  get log() { return data.log; },
  get family() { return data.family; }, // { surname, elderId, celebration }
  get authorized() { return session.authorized; },
  get admin() { return session.admin; }, // хранитель древа
  get me() { return session.name; },     // имя, которым человек представился
  get meId() { return byId(prefs.meId)?.id ?? null; }, // кто он в древе («это я»)
  get rootId() { return prefs.rootId; },
  get theme() { return prefs.theme; },
  get flip() { return prefs.flip; },     // корни внизу, как у настоящего дерева

  byId,
  byBirth,
  childrenOf,
  parentsOf: (id) => existing(byId(id)?.parents || []),
  partnersOf: (id) => existing(byId(id)?.partners || []),
  siblingsOf(id) {
    const parents = byId(id)?.parents || [];
    return data.people.filter((p) => p.id !== id && p.parents.some((x) => parents.includes(x))).sort(byBirth);
  },

  // Корень по умолчанию — предок с самым большим числом потомков.
  autoRoot() {
    const roots = data.people.filter((p) => existing(p.parents).length === 0);
    let best = null;
    let bestScore = -1;
    for (const p of [...roots].sort(byBirth)) {
      const score = descendantCount(p.id);
      if (score > bestScore) { best = p; bestScore = score; }
    }
    return best?.id ?? null;
  },
  effectiveRoot() { return byId(prefs.rootId)?.id ?? this.autoRoot(); },
  topAncestor(id) {
    const seen = new Set();
    let cur = byId(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = existing(cur.parents)[0];
      if (!parent) break;
      cur = parent;
    }
    return cur?.id ?? null;
  },

  stats() {
    // страна — то, что после запятой в «Город, страна»
    const countries = new Set(data.people.filter((p) => p.place.includes(',')).map((p) => p.place.split(',').pop().trim()).filter(Boolean));
    return {
      people: data.people.length,
      generations: Math.max(0, ...data.people.map((p) => depthBelow(p.id))),
      places: countries.size,
    };
  },

  // ── Вход и обновление ────────────────────────────────────
  async init() {
    // Опрос заводится до первого запроса: если связи не было, страница сама догонит, когда она вернётся.
    const poll = () => { if (!document.hidden) (ready ? this.refresh(true) : this.connect()).catch(() => {}); };
    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    await this.connect();
  },
  // Первый разговор с сервером: вошёл ли человек и как называется древо.
  async connect() {
    const s = await api('GET', '/api/session');
    ready = true;
    data.family = { ...data.family, surname: s.surname };
    session = { ...session, authorized: s.authorized, name: s.name, admin: s.admin };
    if (s.authorized) await this.refresh();
  },
  // Подтягивает то, что дописали другие. Если версия на сервере та же — ничего не перерисовывается.
  async refresh(remote = false) {
    if (session.authorized) await request('GET', `/api/state?v=${data.version}`, undefined, remote);
  },
  login: (name, code) => request('POST', '/api/login', { name, code }),
  setMe: (name) => request('POST', '/api/name', { name }),
  async logout() {
    await api('POST', '/api/logout');
    location.reload();
  },
  inviteLink: () => `${location.origin}${location.pathname}#invite=${encodeURIComponent(session.inviteCode)}`,
  get inviteCode() { return session.inviteCode; },

  // ── Личные настройки этого устройства ────────────────────
  setMeId: (id) => setPref('meId', id),
  setRoot: (id) => setPref('rootId', id),
  setTheme: (theme) => setPref('theme', theme),
  setFlip: (flip) => setPref('flip', flip),

  // ── Изменения древа ──────────────────────────────────────
  // rel: { type: 'child' | 'partner' | 'parent', id } — к кому дописываем ветвь. Возвращает id нового человека.
  addPerson: async (fields, rel) => (await request('POST', '/api/people', { ...fields, rel: rel || null })).createdId,
  updatePerson: (id, patch) => request('PATCH', `/api/people/${id}`, patch),
  removePerson: (id) => request('DELETE', `/api/people/${id}`),
  uploadPhoto: async (blob) => (await api('POST', '/api/photos', blob)).url,
  // дописывает снимки к тем, что уже есть на сервере, — в отличие от updatePerson({ photos }), который заменяет список
  addPhotos: (id, urls) => request('PATCH', `/api/people/${id}`, { addPhotos: urls }),

  addMemory: (personId, text, prompt = '') => request('POST', `/api/people/${personId}/memories`, { text, prompt }),
  removeMemory: (personId, memoryId) => request('DELETE', `/api/people/${personId}/memories/${memoryId}`),
  toggleHeart: (personId, memoryId) => request('POST', `/api/people/${personId}/memories/${memoryId}/heart`),

  // Название древа и праздник, к которому собирают книгу воспоминаний (только хранитель).
  setFamily: (patch) => request('PATCH', '/api/family', patch),
};
