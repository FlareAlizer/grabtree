// Проверка сервера через HTTP: вход, права, изменения древа, фото, сохранность данных.
// Каждый запуск работает во временной папке и стирает её за собой. Запуск: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { limiterKey } from '../server/auth.mjs';

const FAMILY_CODE = 'iva-topol-vyaz-17';
const ADMIN_CODE = 'test-keeper-code-905';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

// Отдельный сервер на своей папке данных. dataDir передают, чтобы поднять его заново на тех же данных.
async function launch({ env = {}, proxyHops = 0, dataDir } = {}) {
  const dir = dataDir || await mkdtemp(join(tmpdir(), 'grabtree-test-'));
  const app = await createApp({ dataDir: dir, publicDir: 'src', env: { FAMILY_CODE, ADMIN_CODE, ...env }, proxyHops });
  const server = createServer(app.handle);
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  return {
    dir,
    base: `http://127.0.0.1:${server.address().port}`,
    async stop({ keepData = false } = {}) {
      await new Promise((done) => server.close(done));
      await app.close();
      if (!keepData) await rm(dir, { recursive: true, force: true });
    },
  };
}

// Клиент со своими cookie — как отдельный человек со своим устройством.
// site — функция, чтобы клиент пережил перезапуск сервера на другом порту.
function client(site) {
  const jar = new Map();
  async function call(method, path, body, headers = {}) {
    const init = { method, headers: { ...headers } };
    if (jar.size && !init.headers.cookie) init.headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (Buffer.isBuffer(body)) {
      init.body = body;
      init.headers['content-type'] = 'image/jpeg';
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
    const res = await fetch(site().base + path, init);
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      const name = pair.slice(0, pair.indexOf('='));
      const value = pair.slice(pair.indexOf('=') + 1);
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    const isJson = (res.headers.get('content-type') || '').includes('json');
    return { status: res.status, body: isJson ? await res.json() : await res.text(), headers: res.headers };
  }
  call.jar = jar;
  return call;
}

let main;
const here = () => main;

async function member(name, code = FAMILY_CODE, site = here) {
  const call = client(site);
  const res = await call('POST', '/api/login', { name, code });
  assert.equal(res.status, 200, `вход ${name}`);
  return call;
}
const wrongLogin = (call, headers) => call('POST', '/api/login', { name: 'Чужой', code: `guess-${Math.random()}` }, headers);

before(async () => { main = await launch(); });
after(() => main.stop());

test('без входа данные закрыты, а сама страница открывается', async () => {
  const guest = client(here);
  assert.equal((await guest('GET', '/api/state')).status, 401);
  assert.equal((await guest('POST', '/api/people', { first: 'Чужой' })).status, 401);
  assert.equal((await guest('GET', '/uploads/0123456789abcdef.jpg')).status, 401);
  assert.deepEqual((await guest('GET', '/api/session')).body, { authorized: false, name: '', admin: false, surname: '' });

  const page = await guest('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /<title>/);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await guest('GET', '/../server/app.mjs')).status, 404);
  assert.equal((await guest('GET', '/%2e%2e/package.json')).status, 404);
});

test('вход: нужен код и имя; код не чувствителен к регистру и пробелам', async () => {
  const guest = client(here);
  assert.equal((await guest('POST', '/api/login', { name: '  ', code: FAMILY_CODE })).status, 400);

  const ok = await guest('POST', '/api/login', { name: ' Первая ', code: ' IVA topol-Vyaz 17 ' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.me, { name: 'Первая', admin: false });
  assert.equal(ok.body.inviteCode, FAMILY_CODE);
  assert.ok(ok.headers.getSetCookie().every((line) => /HttpOnly; SameSite=Lax/.test(line)));

  assert.equal((await guest('GET', '/api/session')).body.authorized, true);
  assert.equal((await guest('POST', '/api/name', { name: 'Первая Родственница' })).body.me.name, 'Первая Родственница');

  await guest('POST', '/api/logout');
  assert.equal((await guest('GET', '/api/state')).status, 401);
});

test('испорченная cookie — это просто «не вошёл», а не ошибка сервера', async () => {
  const guest = client(here);
  for (const cookie of ['gt_session=abc', `gt_session=abc.${'x'.repeat(42)}\xff`, 'gt_session=.', 'gt_device=zzz.yyy; gt_session=a.b']) {
    assert.equal((await guest('GET', '/api/state', undefined, { cookie })).status, 401, cookie);
    assert.equal((await guest('GET', '/api/session', undefined, { cookie })).status, 200, cookie);
  }
});

test('древо: первый человек, супруг, ребёнок, родители — связи расставляет сервер', async () => {
  const one = await member('Первая');
  const vera = (await one('POST', '/api/people', { first: 'Вера', last: 'Тестова', gender: 'f', born: '1950-11-15' })).body.createdId;
  const gleb = (await one('POST', '/api/people', { first: 'Глеб', gender: 'm', rel: { type: 'partner', id: vera } })).body.createdId;
  const added = await one('POST', '/api/people', { first: 'Нина', gender: 'f', rel: { type: 'child', id: vera } });
  const nina = added.body.createdId;

  const people = Object.fromEntries(added.body.people.map((p) => [p.id, p]));
  assert.deepEqual(people[vera].partners, [gleb]);
  assert.deepEqual(people[gleb].partners, [vera]);
  assert.deepEqual(people[nina].parents, [vera, gleb]);
  assert.equal(people[nina].addedBy, 'Первая');
  assert.equal(added.body.log[0].type, 'person');

  // родители: второй становится супругом первого, третьего добавить нельзя
  const mother = (await one('POST', '/api/people', { first: 'Зоя', gender: 'f', rel: { type: 'parent', id: vera } })).body.createdId;
  const second = await one('POST', '/api/people', { first: 'Фёдор', gender: 'm', rel: { type: 'parent', id: vera } });
  const father = second.body.createdId;
  assert.deepEqual(second.body.people.find((p) => p.id === father).partners, [mother]);
  assert.deepEqual(second.body.people.find((p) => p.id === vera).parents, [mother, father]);
  assert.equal((await one('POST', '/api/people', { first: 'Лишний', rel: { type: 'parent', id: vera } })).status, 409);

  assert.equal((await one('POST', '/api/people', { last: 'Без имени' })).status, 400);
  assert.equal((await one('POST', '/api/people', { first: 'Сирота', rel: { type: 'child', id: 'nobody' } })).status, 404);
});

test('правка: меняются только известные поля, ввод проверяется', async () => {
  const one = await member('Первая');
  const id = (await one('POST', '/api/people', { first: 'Лидия', gender: 'f' })).body.createdId;

  const patched = await one('PATCH', `/api/people/${id}`, { place: 'Тверь,  Россия ', story: 'Первая строка.\n\nВторая.', id: 'hack', parents: ['x'], addedBy: 'не я' });
  const lidia = patched.body.people.find((p) => p.id === id);
  assert.equal(lidia.place, 'Тверь, Россия');
  assert.equal(lidia.story, 'Первая строка.\n\nВторая.');
  assert.deepEqual(lidia.parents, []);
  assert.equal(lidia.addedBy, 'Первая');
  assert.equal(patched.body.log[0].type, 'story');

  assert.equal((await one('PATCH', `/api/people/${id}`, { gender: 'x' })).status, 400);
  assert.equal((await one('PATCH', `/api/people/${id}`, { first: '' })).status, 400);
  assert.equal((await one('PATCH', `/api/people/${id}`, { first: 'я'.repeat(81) })).status, 400);
  assert.equal((await one('PATCH', `/api/people/${id}`, { photos: ['https://evil.example/x.jpg'] })).status, 400);
  assert.equal((await one('PATCH', `/api/people/${id}`, { addPhotos: ['/uploads/../db.json'] })).status, 400);
  assert.equal((await one('PATCH', `/api/people/${id}`, { story: 42 })).status, 400);
  assert.equal((await one('PATCH', '/api/people/nobody', { first: 'Кто' })).status, 404);
});

test('воспоминания: у каждого свои сердечки, удаляет автор или хранитель', async () => {
  const one = await member('Первая');
  const two = await member('Второй');
  const keeper = await member('Хранитель', ADMIN_CODE);
  const id = (await one('POST', '/api/people', { first: 'Бабушка', gender: 'f' })).body.createdId;
  const memories = (state) => state.people.find((p) => p.id === id).memories;

  assert.equal((await one('POST', `/api/people/${id}/memories`, { text: '   ' })).status, 400);
  const first = memories((await one('POST', `/api/people/${id}/memories`, { text: 'Ватрушки по субботам', prompt: 'Какое блюдо?' })).body)[0];
  assert.deepEqual({ by: first.by, text: first.text, prompt: first.prompt, hearts: first.hearts, liked: first.liked, canDelete: first.canDelete },
    { by: 'Первая', text: 'Ватрушки по субботам', prompt: 'Какое блюдо?', hearts: 0, liked: false, canDelete: true });

  const liked = memories((await two('POST', `/api/people/${id}/memories/${first.id}/heart`)).body)[0];
  assert.deepEqual({ hearts: liked.hearts, liked: liked.liked, canDelete: liked.canDelete }, { hearts: 1, liked: true, canDelete: false });
  const seenByAuthor = memories((await one('GET', '/api/state')).body)[0];
  assert.deepEqual({ hearts: seenByAuthor.hearts, liked: seenByAuthor.liked }, { hearts: 1, liked: false });
  assert.equal(memories((await two('POST', `/api/people/${id}/memories/${first.id}/heart`)).body)[0].hearts, 0);

  assert.equal((await two('DELETE', `/api/people/${id}/memories/${first.id}`)).status, 403);
  assert.equal(memories((await one('DELETE', `/api/people/${id}/memories/${first.id}`)).body).length, 0);

  const second = memories((await two('POST', `/api/people/${id}/memories`, { text: 'Домино во дворе' })).body)[0];
  assert.equal((await keeper('DELETE', `/api/people/${id}/memories/${second.id}`)).status, 200);
});

test('после выхода и нового входа человек остаётся собой: его записи и сердечки при нём', async () => {
  const one = await member('Первая');
  const two = await member('Второй');
  const id = (await one('POST', '/api/people', { first: 'Свой' })).body.createdId;
  const note = (await two('POST', `/api/people/${id}/memories`, { text: 'Запись второго' })).body.people.find((p) => p.id === id).memories[0];
  await one('POST', `/api/people/${id}/memories/${note.id}/heart`);

  await one('POST', '/api/logout');
  assert.equal((await one('GET', '/api/state')).status, 401);
  const back = (await one('POST', '/api/login', { name: 'Первая', code: FAMILY_CODE })).body.people.find((p) => p.id === id);
  assert.equal(back.canDelete, true);
  assert.deepEqual({ hearts: back.memories[0].hearts, liked: back.memories[0].liked }, { hearts: 1, liked: true });

  // чужую метку устройства подделать нельзя: с ней человек просто новый
  const stranger = client(here);
  const forged = await stranger('POST', '/api/login', { name: 'Чужой', code: FAMILY_CODE }, { cookie: 'gt_device=eyJ1IjoiYWJjIn0.AAAA' });
  assert.equal(forged.body.people.find((p) => p.id === id).canDelete, false);
});

test('удаление человека: тот, кто добавил, или хранитель; связи чистятся и попадают в журнал', async () => {
  const one = await member('Первая');
  const two = await member('Второй');
  const keeper = await member('Хранитель', ADMIN_CODE);
  const parent = (await one('POST', '/api/people', { first: 'Родитель' })).body.createdId;
  const child = (await two('POST', '/api/people', { first: 'Ребёнок', rel: { type: 'child', id: parent } })).body.createdId;

  const seenByTwo = (await two('GET', '/api/state')).body.people;
  assert.equal(seenByTwo.find((p) => p.id === parent).canDelete, false);
  assert.equal(seenByTwo.find((p) => p.id === child).canDelete, true);
  assert.equal((await two('DELETE', `/api/people/${parent}`)).status, 403);

  const afterDelete = await keeper('DELETE', `/api/people/${parent}`);
  assert.equal(afterDelete.status, 200);
  assert.deepEqual(afterDelete.body.people.find((p) => p.id === child).parents, []);
  assert.equal((await two('DELETE', `/api/people/${child}`)).status, 200);

  const journal = (await readFile(join(main.dir, 'journal.ndjson'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  const removal = journal.find((entry) => entry.op === 'removePerson' && entry.id === parent);
  assert.deepEqual({ children: removal.children, partners: removal.partners, name: removal.person.first }, { children: [child], partners: [], name: 'Родитель' });
});

test('фото: принимаются только картинки и отдаются только своим', async () => {
  const one = await member('Первая');
  assert.equal((await one('POST', '/api/photos', Buffer.from('<script>alert(1)</script>'))).status, 415);
  assert.equal((await one('POST', '/api/photos', Buffer.alloc(7 * 1024 * 1024, 0xff))).status, 413);

  const upload = await one('POST', '/api/photos', JPEG);
  assert.equal(upload.status, 200);
  assert.match(upload.body.url, /^\/uploads\/[a-f0-9]{16}\.jpg$/);

  const id = (await one('POST', '/api/people', { first: 'С фото' })).body.createdId;
  const saved = await one('PATCH', `/api/people/${id}`, { photos: [upload.body.url] });
  assert.deepEqual(saved.body.people.find((p) => p.id === id).photos, [upload.body.url]);
  assert.equal(saved.body.log[0].type, 'photo');

  const image = await one('GET', upload.body.url);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal((await client(here)('GET', upload.body.url)).status, 401);
});

test('фото дописываются к списку и не затирают то, что в это время добавил другой', async () => {
  const one = await member('Первая');
  const two = await member('Второй');
  const [a, b, c] = await Promise.all([1, 2, 3].map(async () => (await one('POST', '/api/photos', JPEG)).body.url));
  const id = (await one('POST', '/api/people', { first: 'Альбом', addPhotos: [a] })).body.createdId;

  await Promise.all([one('PATCH', `/api/people/${id}`, { addPhotos: [b] }), two('PATCH', `/api/people/${id}`, { addPhotos: [c] })]);
  const photos = (await one('PATCH', `/api/people/${id}`, { addPhotos: [a] })).body.people.find((p) => p.id === id).photos;
  assert.deepEqual([...photos].sort(), [a, b, c].sort());
  assert.equal(photos[0], a); // портрет остаётся первым
});

test('пачка одновременных загрузок не обходит лимит на человека', async () => {
  const one = await member('Первая');
  const statuses = (await Promise.all(Array.from({ length: 130 }, () => one('POST', '/api/photos', JPEG)))).map((res) => res.status);
  assert.equal(statuses.filter((status) => status === 200).length, 120);
  assert.equal(statuses.filter((status) => status === 429).length, 10);
});

test('настройки древа и резервная копия — только у хранителя', async () => {
  const one = await member('Первая');
  const keeper = await member('Хранитель', ADMIN_CODE);
  const id = (await one('POST', '/api/people', { first: 'Именинница', born: '1950-11-15' })).body.createdId;

  assert.equal((await one('PATCH', '/api/family', { surname: 'Чужих' })).status, 403);
  assert.equal((await one('GET', '/api/export')).status, 403);
  assert.equal((await keeper('PATCH', '/api/family', { celebration: '15.11.2026' })).status, 400);

  const set = await keeper('PATCH', '/api/family', { surname: 'Тестовых', elderId: id, celebration: '2026-11-15' });
  assert.deepEqual(set.body.family, { surname: 'Тестовых', elderId: id, celebration: '2026-11-15' });
  assert.equal(set.body.me.admin, true);
  assert.equal((await client(here)('GET', '/api/session')).body.surname, 'Тестовых');

  const backup = await keeper('GET', '/api/export');
  assert.equal(backup.status, 200);
  assert.match(backup.headers.get('content-disposition'), /attachment; filename="grabtree-/);
  assert.ok(backup.body.people.some((p) => p.id === id));

  // если именинника удалили, праздник снимается вместе с ним
  assert.deepEqual((await keeper('DELETE', `/api/people/${id}`)).body.family, { surname: 'Тестовых', elderId: null, celebration: '' });
});

test('опрос изменений: «ничего нового», пока версия та же', async () => {
  const one = await member('Первая');
  const { version } = (await one('GET', '/api/state')).body;
  assert.deepEqual((await one('GET', `/api/state?v=${version}`)).body, { version, unchanged: true });
  await one('POST', '/api/people', { first: 'Новый' });
  assert.ok((await one('GET', `/api/state?v=${version}`)).body.people);
});

test('запросы с чужого сайта отклоняются', async () => {
  const one = await member('Первая');
  assert.equal((await one('POST', '/api/people', { first: 'Подлог' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await one('POST', '/api/people', { first: 'Свой' }, { origin: main.base })).status, 200);
});

test('данные переживают перезапуск; ведутся журнал и копии', async () => {
  const one = await member('Первая');
  const id = (await one('POST', '/api/people', { first: 'Долгожитель' })).body.createdId;
  const { dir } = main;
  await main.stop({ keepData: true });
  main = await launch({ dataDir: dir });

  const state = await one('GET', '/api/state'); // прежняя cookie действует и после перезапуска
  assert.equal(state.status, 200);
  assert.ok(state.body.people.some((p) => p.id === id));

  const journal = (await readFile(join(dir, 'journal.ndjson'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(journal.some((entry) => entry.op === 'addPerson' && entry.id === id && entry.by === 'Первая'));
  assert.ok((await readdir(join(dir, 'backups'))).some((name) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(name)));
  assert.doesNotMatch(JSON.stringify(state.body), /addedByUid|"uid"/);
});

test('название древа из настроек установки применяется только при самом первом запуске', async () => {
  let site = await launch({ env: { FAMILY_SURNAME: 'Тестовых' } });
  const keeper = await member('Хранитель', ADMIN_CODE, () => site);
  assert.equal((await keeper('GET', '/api/session')).body.surname, 'Тестовых');
  assert.equal((await keeper('PATCH', '/api/family', { surname: '' })).body.family.surname, '');

  const { dir } = site;
  await site.stop({ keepData: true });
  site = await launch({ env: { FAMILY_SURNAME: 'Тестовых' }, dataDir: dir });
  assert.equal((await keeper('GET', '/api/session')).body.surname, ''); // хранитель убрал название — оно не возвращается
  await site.stop();
});

test('общий потолок на фотографии', async () => {
  const site = await launch({ env: { UPLOADS_LIMIT_MB: String(30 / 1024 / 1024) } }); // 30 байт: два снимка по 12 помещаются, третий нет
  const one = await member('Первая', FAMILY_CODE, () => site);
  assert.deepEqual([(await one('POST', '/api/photos', JPEG)).status, (await one('POST', '/api/photos', JPEG)).status, (await one('POST', '/api/photos', JPEG)).status], [200, 200, 507]);
  await site.stop();
});

test('подбор кода: после восьми неверных попыток вход закрывается на время', async () => {
  const site = await launch();
  const guest = client(() => site);
  for (let i = 0; i < 8; i++) assert.equal((await wrongLogin(guest)).status, 401);
  assert.equal((await wrongLogin(guest)).status, 429);
  assert.equal((await guest('POST', '/api/login', { name: 'Первая', code: FAMILY_CODE })).status, 429);
  await site.stop();
});

test('удачный вход по слову семьи не обнуляет счётчик: код хранителя так не подобрать', async () => {
  const site = await launch();
  const guest = client(() => site);
  for (let i = 0; i < 7; i++) assert.equal((await wrongLogin(guest)).status, 401);
  assert.equal((await guest('POST', '/api/login', { name: 'Первая', code: FAMILY_CODE })).status, 200);
  assert.equal((await wrongLogin(guest)).status, 401);
  assert.equal((await wrongLogin(guest)).status, 429);
  await site.stop();
});

test('за прокси подделанный X-Forwarded-For не помогает обойти защиту и не блокирует других', async () => {
  const site = await launch({ proxyHops: 1 });
  const attacker = client(() => site);
  // прокси дописывает настоящий адрес последним; первый элемент присылает сам посетитель
  for (let i = 0; i < 8; i++) assert.equal((await wrongLogin(attacker, { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.9` })).status, 401);
  assert.equal((await wrongLogin(attacker, { 'x-forwarded-for': '10.0.0.99, 203.0.113.9' })).status, 429);

  const relative = client(() => site);
  const honest = await relative('POST', '/api/login', { name: 'Первая', code: FAMILY_CODE }, { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' });
  assert.equal(honest.status, 200); // адрес нападавшего, подставленный в заголовок, честному посетителю не мешает
  await site.stop();
});

test('подбор кода с адресов одной сети IPv6 считается как с одного адреса', async () => {
  const site = await launch({ proxyHops: 1 });
  const guest = client(() => site);
  for (let i = 1; i <= 8; i++) assert.equal((await wrongLogin(guest, { 'x-forwarded-for': `2001:db8:1:2::${i.toString(16)}` })).status, 401);
  assert.equal((await wrongLogin(guest, { 'x-forwarded-for': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' })).status, 429);
  assert.equal((await wrongLogin(guest, { 'x-forwarded-for': '2001:db8:1:3::1' })).status, 401); // соседняя сеть — свой счёт
  await site.stop();

  assert.equal(limiterKey('2001:0DB8:0001:0002:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(limiterKey('::1'), '0:0:0:0::/64');
  assert.equal(limiterKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(limiterKey('64:ff9b::203.0.113.9'), '64:ff9b:0:0::/64');
  assert.equal(limiterKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(limiterKey('203.0.113.9'), '203.0.113.9');
});

test('подбор кода с множества адресов упирается в общий потолок', async () => {
  const site = await launch({ proxyHops: 1 });
  const guest = client(() => site);
  for (let i = 0; i < 100; i++) assert.equal((await wrongLogin(guest, { 'x-forwarded-for': `198.51.100.${i}` })).status, 401);
  assert.equal((await wrongLogin(guest, { 'x-forwarded-for': '192.0.2.1' })).status, 429);
  // пока потолок исчерпан, не помогает и верный код — иначе по ответу было бы видно, что он угадан
  assert.equal((await guest('POST', '/api/login', { name: 'Первая', code: FAMILY_CODE }, { 'x-forwarded-for': '192.0.2.2' })).status, 429);
  await site.stop();
});

test('смена имени не продлевает сессию: срок считается от ввода кода', async () => {
  const one = await member('Первая');
  const issuedAt = () => JSON.parse(Buffer.from(one.jar.get('gt_session').split('.')[0], 'base64url')).t;
  const before = issuedAt();
  await new Promise((done) => setTimeout(done, 15));
  assert.equal((await one('POST', '/api/name', { name: 'Первая Родственница' })).status, 200);
  assert.equal(issuedAt(), before);
  assert.equal((await one('GET', '/api/state')).body.me.name, 'Первая Родственница');
});

test('кривой адрес запроса — ответ 400, а не ошибка сервера', async () => {
  const { port } = new URL(main.base);
  const status = await new Promise((resolve, reject) => {
    const socket = connect(Number(port), '127.0.0.1', () => socket.write('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
    let head = '';
    socket.on('data', (chunk) => { head += chunk; });
    socket.on('close', () => resolve(Number(head.split(' ')[1])));
    socket.on('error', reject);
  });
  assert.equal(status, 400);
});

test('сервер не запускается с непонятным TRUST_PROXY', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grabtree-test-'));
  const run = spawnSync(process.execPath, ['server/index.mjs'], { env: { ...process.env, TRUST_PROXY: 'yes', DATA_DIR: dir, PORT: '0' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /TRUST_PROXY/);
  assert.deepEqual(await readdir(dir), []); // до данных дело не дошло
  await rm(dir, { recursive: true, force: true });
});
