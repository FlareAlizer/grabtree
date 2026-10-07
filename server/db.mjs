// Данные древа: один JSON-файл с атомарной записью, журнал правок и ежедневные копии.
// Все изменения идут через функции этого модуля — они же проверяют ввод и права.
import { mkdir, readFile, writeFile, rename, appendFile, copyFile, readdir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { HttpError } from './http.mjs';

const MAX = { people: 5000, memories: 500, photos: 40, log: 60, backups: 30 };
const BACKUP_EVERY = 6 * 3600 * 1000;
export const PHOTO_URL = /^\/uploads\/[a-f0-9]{16}\.(jpg|png|webp)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Текстовые поля человека: [максимум символов, подпись для ошибки, многострочное]
const FIELDS = {
  first: [80, 'Имя'],
  last: [80, 'Фамилия'],
  maiden: [80, 'Фамилия при рождении'],
  born: [20, 'Дата рождения'],
  died: [20, 'Дата смерти'],
  place: [120, 'Где живёт'],
  story: [20000, 'История', true],
};

const newId = () => randomBytes(6).toString('hex');
const stamp = () => new Date().toISOString();

function text(value, max, label, multiline = false) {
  if (typeof value !== 'string') throw new HttpError(400, `Поле «${label}» должно быть текстом`);
  let clean = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (!multiline) clean = clean.replace(/\s+/g, ' ');
  clean = clean.trim();
  if (clean.length > max) throw new HttpError(400, `Поле «${label}» слишком длинное`);
  return clean;
}

function photoList(value) {
  const ok = Array.isArray(value) && value.length <= MAX.photos && value.every((p) => typeof p === 'string' && PHOTO_URL.test(p));
  if (!ok) throw new HttpError(400, 'Не получилось сохранить фотографии');
  return [...new Set(value)];
}

// Из запроса берутся только известные поля; всё остальное игнорируется.
// photos заменяет список снимков целиком, addPhotos — дописывает к тому, что уже есть.
function personFields(input) {
  const out = {};
  for (const [key, [max, label, multiline]] of Object.entries(FIELDS)) {
    if (key in input) out[key] = text(input[key], max, label, multiline);
  }
  if ('gender' in input) {
    if (input.gender !== 'f' && input.gender !== 'm') throw new HttpError(400, 'Укажите пол');
    out.gender = input.gender;
  }
  if ('photos' in input) out.photos = photoList(input.photos);
  if ('addPhotos' in input) out.addPhotos = photoList(input.addPhotos);
  return out;
}

export async function openDb(dir) {
  const file = join(dir, 'db.json');
  const backups = join(dir, 'backups');
  await mkdir(join(dir, 'uploads'), { recursive: true });
  await mkdir(backups, { recursive: true });

  let db = { version: 1, family: { surname: '', elderId: null, celebration: '' }, people: [], log: [] };
  let existed = true;
  try {
    db = { ...db, ...JSON.parse(await readFile(file, 'utf8')) };
  } catch (err) {
    // Нет файла — первое включение. Любая другая ошибка — стоп: повреждённую базу нельзя молча перезаписать.
    if (err.code !== 'ENOENT') throw new Error(`Не удалось прочитать базу ${file}: ${err.message}`);
    existed = false;
  }
  for (const p of db.people) {
    p.photos ||= [];
    p.parents ||= [];
    p.partners ||= [];
    p.memories ||= [];
    for (const m of p.memories) m.hearts ||= [];
  }

  // ── Запись на диск ───────────────────────────────────────
  let queue = Promise.resolve();
  function save() {
    db.version++;
    const snapshot = JSON.stringify(db);
    const next = queue.then(async () => {
      // сначала во временный файл, потом подмена: при сбое на диске остаётся целая прежняя версия
      await writeFile(`${file}.tmp`, snapshot, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    });
    queue = next.catch(() => {});
    return next;
  }

  // Журнал: кто, когда и что изменил. Нужен, чтобы разобраться и восстановить, если что-то сотрут.
  function journal(user, op, details) {
    const line = JSON.stringify({ at: stamp(), uid: user.uid, by: user.name, op, ...details });
    appendFile(join(dir, 'journal.ndjson'), `${line}\n`).catch((err) => console.error('journal:', err.message));
  }

  async function backup() {
    if (!db.people.length) return;
    await queue;
    await copyFile(file, join(backups, `db-${stamp().slice(0, 10)}.json`));
    const old = (await readdir(backups)).filter((name) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().slice(0, -MAX.backups);
    for (const name of old) await unlink(join(backups, name));
  }
  const safeBackup = () => backup().catch((err) => console.error('backup:', err.message));
  if (existed) await safeBackup();
  const timer = setInterval(safeBackup, BACKUP_EVERY);
  timer.unref();

  // ── Поиск и права ────────────────────────────────────────
  const find = (id) => db.people.find((p) => p.id === id);
  function person(id) {
    const p = find(id);
    if (!p) throw new HttpError(404, 'Этого человека уже нет в древе. Обновите страницу.');
    return p;
  }
  function memory(p, memoryId) {
    const m = p.memories.find((x) => x.id === memoryId);
    if (!m) throw new HttpError(404, 'Этой записи уже нет. Обновите страницу.');
    return m;
  }
  const mayRemove = (user, ownerUid) => user.admin || ownerUid === user.uid;

  // Лента «Что нового».
  function note(user, type, personId) {
    db.log = [{ at: stamp(), by: user.name, type, personId }, ...db.log].slice(0, MAX.log);
  }

  // ── То, что видит конкретный человек ─────────────────────
  // Внутренние идентификаторы сессий наружу не отдаются: вместо них — «моё» и «можно удалить».
  function view(user) {
    return {
      version: db.version,
      family: db.family,
      log: db.log,
      people: db.people.map((p) => ({
        id: p.id, first: p.first, last: p.last, maiden: p.maiden, gender: p.gender, born: p.born, died: p.died,
        place: p.place, story: p.story, photos: p.photos, parents: p.parents, partners: p.partners, addedBy: p.addedBy,
        canDelete: mayRemove(user, p.addedByUid),
        memories: p.memories.map((m) => ({
          id: m.id, by: m.by, text: m.text, at: m.at, prompt: m.prompt,
          hearts: m.hearts.length, liked: m.hearts.includes(user.uid), canDelete: mayRemove(user, m.uid),
        })),
      })),
    };
  }

  return {
    get version() { return db.version; },
    get isNew() { return !existed; }, // базы ещё не было: это самый первый запуск
    get family() { return db.family; },
    get raw() { return db; },
    view,
    journal,
    close: () => { clearInterval(timer); return queue; },

    // rel: { type: 'child' | 'partner' | 'parent', id } — к кому дописывают ветвь
    async addPerson(user, input) {
      if (db.people.length >= MAX.people) throw new HttpError(409, 'В древе слишком много людей');
      const { addPhotos: added = [], ...fields } = personFields(input);
      if (!fields.first) throw new HttpError(400, 'Укажите имя');
      fields.photos = [...new Set([...(fields.photos || []), ...added])];
      const p = {
        id: newId(), first: '', last: '', maiden: '', gender: 'f', born: '', died: '', place: '', story: '', photos: [],
        ...fields,
        parents: [], partners: [], memories: [], addedBy: user.name, addedByUid: user.uid, createdAt: stamp(),
      };

      const rel = input.rel;
      if (rel != null) {
        if (typeof rel !== 'object' || !['child', 'partner', 'parent'].includes(rel.type)) throw new HttpError(400, 'Непонятно, кем приходится новый человек');
        const anchor = person(rel.id);
        if (rel.type === 'child') {
          p.parents = [anchor.id, ...(anchor.partners.length === 1 ? anchor.partners : [])];
        } else if (rel.type === 'partner') {
          p.partners = [anchor.id];
          anchor.partners = [...anchor.partners, p.id];
        } else {
          if (anchor.parents.length >= 2) throw new HttpError(409, 'У человека уже указаны оба родителя');
          const other = find(anchor.parents[0]);
          if (other) {
            p.partners = [other.id];
            other.partners = [...other.partners, p.id];
          }
          anchor.parents = [...anchor.parents, p.id];
        }
      }
      db.people.push(p);
      note(user, 'person', p.id);
      journal(user, 'addPerson', { id: p.id, fields, rel: rel || null });
      await save();
      return p.id;
    },

    async updatePerson(user, id, input) {
      const p = person(id);
      const { addPhotos, ...fields } = personFields(input);
      if ('first' in fields && !fields.first) throw new HttpError(400, 'Укажите имя');
      if (addPhotos) {
        // дописываем к актуальному списку — снимки, которые в это же время добавил кто-то другой, не пропадают
        fields.photos = [...new Set([...(fields.photos ?? p.photos), ...addPhotos])];
        if (fields.photos.length > MAX.photos) throw new HttpError(409, `У одного человека может быть не больше ${MAX.photos} фотографий`);
      }
      const storyChanged = fields.story != null && fields.story !== '' && fields.story !== p.story;
      const photosAdded = fields.photos != null && fields.photos.some((url) => !p.photos.includes(url));
      Object.assign(p, fields, { updatedAt: stamp() });
      if (storyChanged) note(user, 'story', id);
      if (photosAdded) note(user, 'photo', id);
      journal(user, 'updatePerson', { id, fields });
      await save();
    },

    async removePerson(user, id) {
      const p = person(id);
      if (!mayRemove(user, p.addedByUid)) throw new HttpError(403, 'Удалить человека может тот, кто его добавил, или хранитель древа');
      // для журнала: у кого этот человек был родителем и супругом — чтобы при восстановлении вернуть и связи
      const children = db.people.filter((x) => x.parents.includes(id)).map((x) => x.id);
      const partners = db.people.filter((x) => x.partners.includes(id)).map((x) => x.id);
      db.people = db.people.filter((x) => x.id !== id);
      for (const other of db.people) {
        other.parents = other.parents.filter((x) => x !== id);
        other.partners = other.partners.filter((x) => x !== id);
      }
      db.log = db.log.filter((entry) => entry.personId !== id);
      if (db.family.elderId === id) db.family = { ...db.family, elderId: null, celebration: '' };
      journal(user, 'removePerson', { id, person: p, children, partners }); // запись целиком — чтобы можно было вернуть
      await save();
    },

    async addMemory(user, personId, input) {
      const p = person(personId);
      if (p.memories.length >= MAX.memories) throw new HttpError(409, 'У этого человека уже очень много записей');
      const body = text(input.text, 2000, 'Воспоминание', true);
      if (!body) throw new HttpError(400, 'Напишите хотя бы пару слов');
      const m = { id: newId(), uid: user.uid, by: user.name, text: body, at: stamp(), prompt: text(input.prompt ?? '', 200, 'Вопрос'), hearts: [] };
      p.memories = [...p.memories, m];
      note(user, 'memory', personId);
      journal(user, 'addMemory', { personId, memory: m });
      await save();
    },

    async removeMemory(user, personId, memoryId) {
      const p = person(personId);
      const m = memory(p, memoryId);
      if (!mayRemove(user, m.uid)) throw new HttpError(403, 'Удалить запись может её автор или хранитель древа');
      p.memories = p.memories.filter((x) => x.id !== memoryId);
      journal(user, 'removeMemory', { personId, memory: m });
      await save();
    },

    async toggleHeart(user, personId, memoryId) {
      const m = memory(person(personId), memoryId);
      m.hearts = m.hearts.includes(user.uid) ? m.hearts.filter((x) => x !== user.uid) : [...m.hearts, user.uid];
      await save();
    },

    // Название древа и праздник, к которому собирают книгу воспоминаний. Меняет только хранитель.
    async setFamily(user, input) {
      if (!user.admin) throw new HttpError(403, 'Настройки древа меняет только хранитель');
      const next = { ...db.family };
      if ('surname' in input) next.surname = text(input.surname, 60, 'Фамилия');
      if ('elderId' in input) next.elderId = input.elderId === null ? null : person(input.elderId).id;
      if ('celebration' in input) {
        if (input.celebration !== '' && !(typeof input.celebration === 'string' && DATE.test(input.celebration))) throw new HttpError(400, 'Дата праздника должна быть в виде ГГГГ-ММ-ДД');
        next.celebration = input.celebration;
      }
      if (!next.elderId) next.celebration = '';
      db.family = next;
      journal(user, 'setFamily', { family: next });
      await save();
    },
  };
}
