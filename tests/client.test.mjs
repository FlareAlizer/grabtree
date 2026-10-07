// Проверка логики сайта, которой не нужен браузер: раскладка древа, родство, даты, вопрос недели.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTree, CARD_W, CARD_H } from '../src/js/layout.js';
import { kinship } from '../src/js/kinship.js';
import { questionOfWeek, nextBirthday } from '../src/js/family.js';
import { excerpt } from '../src/js/stories.js';

const person = (id, extra = {}) => ({
  id, first: id, last: '', gender: 'f', born: '', died: '', place: '', story: '', photos: [], memories: [], parents: [], partners: [], ...extra,
});

// То, что раскладке и родству нужно от хранилища.
function fakeStore(people) {
  const byId = (id) => people.find((p) => p.id === id) || null;
  const existing = (ids) => ids.map(byId).filter(Boolean);
  const byBirth = (a, b) => (parseInt(a.born, 10) || 9999) - (parseInt(b.born, 10) || 9999);
  return {
    people,
    byId,
    byBirth,
    childrenOf: (id) => people.filter((p) => p.parents.includes(id)).sort(byBirth),
    parentsOf: (id) => existing(byId(id)?.parents || []),
    partnersOf: (id) => existing(byId(id)?.partners || []),
  };
}

const xOf = (layout, id) => layout.nodes.find((n) => n.id === id).x;
const centerOf = (layout, id) => xOf(layout, id) + CARD_W / 2;
const childLinkTo = (layout, id) => layout.links.find((l) => l.type === 'child' && l.tx === centerOf(layout, id));

test('раскладка: один брак — пара рядом, ребёнок от середины пары', () => {
  const store = fakeStore([
    person('x', { partners: ['a'] }), person('a', { partners: ['x'] }),
    person('kid', { parents: ['x', 'a'] }),
  ]);
  const layout = layoutTree(store, 'x');
  assert.ok(xOf(layout, 'x') < xOf(layout, 'a'));
  assert.equal(layout.rings.length, 1);
  assert.equal(layout.rings[0].x, (centerOf(layout, 'x') + centerOf(layout, 'a')) / 2);
  assert.equal(childLinkTo(layout, 'kid').ox, layout.rings[0].x);
  assert.equal(layout.generations, 2);
});

test('раскладка: два брака — человек между супругами, кольца только рядом с ним', () => {
  const store = fakeStore([
    person('x', { partners: ['a', 'b'] }), person('a', { partners: ['x'] }), person('b', { partners: ['x'] }),
    person('fromA', { parents: ['x', 'a'], born: '1960' }), person('fromB', { parents: ['x', 'b'], born: '1950' }),
  ]);
  const layout = layoutTree(store, 'x');
  assert.ok(xOf(layout, 'b') < xOf(layout, 'x') && xOf(layout, 'x') < xOf(layout, 'a'), 'порядок: второй супруг, человек, первый супруг');

  const ringXs = layout.rings.map((r) => r.x).sort((p, q) => p - q);
  assert.deepEqual(ringXs, [(centerOf(layout, 'b') + centerOf(layout, 'x')) / 2, (centerOf(layout, 'x') + centerOf(layout, 'a')) / 2]);
  // каждый ребёнок висит под своим браком, дети левого брака — слева
  assert.equal(childLinkTo(layout, 'fromA').ox, (centerOf(layout, 'x') + centerOf(layout, 'a')) / 2);
  assert.equal(childLinkTo(layout, 'fromB').ox, (centerOf(layout, 'b') + centerOf(layout, 'x')) / 2);
  assert.ok(xOf(layout, 'fromB') < xOf(layout, 'fromA'));
});

test('раскладка: третий брак — скоба над карточками, ребёнок от самого супруга', () => {
  const store = fakeStore([
    person('x', { partners: ['a', 'b', 'c'] }), person('a', { partners: ['x'] }), person('b', { partners: ['x'] }), person('c', { partners: ['x'] }),
    person('fromC', { parents: ['x', 'c'] }),
  ]);
  const layout = layoutTree(store, 'x');
  assert.deepEqual(['b', 'x', 'a', 'c'].map((id) => xOf(layout, id)), [...layout.nodes.filter((n) => n.depth === 0).map((n) => n.x)].sort((p, q) => p - q));

  const bracket = layout.rings.find((r) => r.y < 0);
  assert.ok(bracket, 'кольцо третьего брака поднято над рядом');
  assert.ok(bracket.x > centerOf(layout, 'x') && bracket.x < centerOf(layout, 'c'));
  assert.equal(layout.rings.filter((r) => r.y > 0).length, 2);
  // между «a» и «c» кольца нет: они не женаты друг на друге
  assert.ok(!layout.rings.some((r) => r.y > 0 && r.x > centerOf(layout, 'a')));

  const link = childLinkTo(layout, 'fromC');
  assert.equal(link.ox, centerOf(layout, 'c'));
  assert.ok(link.d.startsWith(`M${centerOf(layout, 'c')} ${CARD_H}`), 'линия выходит из нижнего края карточки супруга');
});

test('раскладка: «корни внизу» переворачивает ряды', () => {
  const store = fakeStore([person('x'), person('kid', { parents: ['x'] }), person('grandkid', { parents: ['kid'] })]);
  const yOf = (layout, id) => layout.nodes.find((n) => n.id === id).y;
  const down = layoutTree(store, 'x');
  const up = layoutTree(store, 'x', true);
  assert.ok(yOf(down, 'x') < yOf(down, 'kid') && yOf(down, 'kid') < yOf(down, 'grandkid'));
  assert.ok(yOf(up, 'x') > yOf(up, 'kid') && yOf(up, 'kid') > yOf(up, 'grandkid'));
  assert.equal(down.height, up.height);
});

test('родство: кровные и через брак', () => {
  const store = fakeStore([
    person('grandma', { partners: ['grandpa'] }), person('grandpa', { gender: 'm', partners: ['grandma'] }),
    person('mom', { parents: ['grandma', 'grandpa'], partners: ['dad'] }), person('dad', { gender: 'm', partners: ['mom'] }),
    person('uncle', { gender: 'm', parents: ['grandma', 'grandpa'], partners: ['aunt'] }), person('aunt', { partners: ['uncle'] }),
    person('me', { parents: ['mom', 'dad'], partners: ['husband'] }), person('husband', { gender: 'm', partners: ['me'], parents: ['inlaw'] }),
    person('inlaw'), person('cousin', { gender: 'm', parents: ['uncle', 'aunt'] }), person('son', { gender: 'm', parents: ['me', 'husband'] }),
    person('stranger'),
  ]);
  const kin = (id) => kinship(store, 'me', id);
  assert.deepEqual(
    ['me', 'grandma', 'grandpa', 'mom', 'uncle', 'aunt', 'cousin', 'husband', 'inlaw', 'son', 'stranger'].map(kin),
    ['это вы', 'бабушка', 'дедушка', 'мать', 'дядя', 'жена дяди', 'двоюродный брат', 'муж', 'свекровь', 'сын', null],
  );
  assert.equal(kinship(store, 'son', 'grandma'), 'прабабушка');
  assert.equal(kinship(store, 'grandma', 'son'), 'правнук');
  assert.equal(kinship(store, 'husband', 'mom'), 'тёща');
});

test('вопрос недели: меняется по понедельникам и со временем задаёт каждому все вопросы', () => {
  const store = fakeStore([person('a', { born: '1930' }), person('b', { born: '1935' }), person('c', { born: '2000' }), person('d', { born: '2010' })]);
  const monday = new Date(2026, 9, 5); // понедельник, 5 октября 2026
  const ask = (offset) => questionOfWeek(store, new Date(2026, 9, 5 + offset, 12));
  assert.equal(monday.getDay(), 1);
  for (let day = 1; day < 7; day++) assert.deepEqual(ask(day), ask(0), `день ${day} той же недели`);
  assert.notDeepEqual(ask(7), ask(0));
  assert.notDeepEqual(ask(-1), ask(0));

  // спрашивают только о старшей половине; за 12 недель каждому из двоих достаются все шесть вопросов
  const asked = { a: new Set(), b: new Set() };
  for (let week = 0; week < 12; week++) {
    const q = ask(week * 7);
    asked[q.person.id].add(q.text);
  }
  assert.deepEqual([asked.a.size, asked.b.size], [6, 6]);
  assert.equal(questionOfWeek(fakeStore([]), monday), null);
});

test('ближайший день рождения и начало рассказа', () => {
  const now = new Date(2026, 9, 7);
  assert.equal(nextBirthday('1950-11-15', now), '2026-11-15');
  assert.equal(nextBirthday('07.10.1990', now), '2026-10-07');
  assert.equal(nextBirthday('1990-03-01', now), '2027-03-01');
  assert.equal(nextBirthday('1990', now), null);

  assert.equal(excerpt('Короткий рассказ.'), 'Короткий рассказ.');
  assert.equal(excerpt('слово '.repeat(100)).length <= 301, true);
  assert.equal(excerpt('я'.repeat(5000)).length, 301); // без пробелов текст всё равно обрезается
});
