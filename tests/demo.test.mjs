// Демо-семья из scripts/demo-family.mjs заселяется через те же функции, что и настоящие правки,
// поэтому заодно это проверка: демо не отстало от сервера и клиента.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { seedDemoFamily } from '../scripts/demo-family.mjs';
import { celebrationInfo, upcomingDates, geography } from '../src/js/family.js';
import { layoutTree } from '../src/js/layout.js';
import { kinship } from '../src/js/kinship.js';

test('демо-семья: четыре поколения, книга к юбилею, ближайшие даты', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grabtree-test-'));
  const app = await createApp({ dataDir: dir, publicDir: 'src', env: {} });
  const now = new Date(2026, 9, 7, 12);
  const id = await seedDemoFamily(app.db, now);
  const { people, family, log } = app.db.view({ uid: 'demo-Тимофей', name: 'Тимофей', admin: false });

  // то, что клиенту нужно от хранилища
  const byId = (key) => people.find((p) => p.id === key) || null;
  const byBirth = (a, b) => (parseInt(a.born, 10) || 9999) - (parseInt(b.born, 10) || 9999);
  const store = {
    people, family, byId, byBirth,
    childrenOf: (key) => people.filter((p) => p.parents.includes(key)).sort(byBirth),
    parentsOf: (key) => byId(key).parents.map(byId),
    partnersOf: (key) => byId(key).partners.map(byId),
  };

  assert.equal(people.length, 15);
  assert.equal(family.surname, 'Листопадовых');
  assert.equal(layoutTree(store, id.serafima).generations, 4);
  assert.equal(kinship(store, id.timofey, id.serafima), 'бабушка');
  assert.equal(kinship(store, id.timofey, id.eva), 'двоюродная сестра');

  const fest = celebrationInfo(store, now);
  assert.deepEqual({ age: fest.age, daysLeft: fest.daysLeft, filled: fest.filled }, { age: 85, daysLeft: 19, filled: 7 });
  assert.deepEqual(upcomingDates(store, now).map((e) => [e.person.first, e.type, e.inDays]),
    [['Нонна', 'birthday', 4], ['Серафима', 'birthday', 19], ['Аркадий', 'memorial', 33], ['Василиса', 'birthday', 52], ['Родион', 'birthday', 84]]);
  assert.equal(geography(store).length, 5);

  const liked = byId(id.serafima).memories.find((m) => m.by === 'Злата');
  assert.deepEqual({ hearts: liked.hearts, liked: liked.liked }, { hearts: 4, liked: true });
  assert.ok(new Date(log[0].at) < now && new Date(log.at(-1).at) < new Date(log[0].at)); // лента идёт от новых записей к старым

  await app.close();
  const saved = JSON.parse(await readFile(join(dir, 'db.json'), 'utf8'));
  assert.equal(saved.people.length, 15); // подправленное время записей дошло до диска
  assert.equal(saved.log[0].at, log[0].at);
  await rm(dir, { recursive: true, force: true });
});
