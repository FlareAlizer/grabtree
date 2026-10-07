// Выборки для раздела «Сегодня»: что происходит в семье и чего в древе не хватает.
import { parseDate, yearOf, plural } from './util.js';

const DAY = 864e5;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Ближайший день рождения в виде ГГГГ-ММ-ДД; null, если известен только год.
export function nextBirthday(born, now = new Date()) {
  const date = parseDate(born);
  if (!date?.d) return null;
  const today = startOfDay(now);
  const thisYear = new Date(today.getFullYear(), date.m - 1, date.d);
  return iso(thisYear < today ? new Date(today.getFullYear() + 1, date.m - 1, date.d) : thisYear);
}

// Праздник, к которому собирается книга воспоминаний: день рождения старейшины.
// Его выбирает хранитель древа; пока не выбран — возвращается null.
export function celebrationInfo(store, now = new Date()) {
  const elder = store.byId(store.family.elderId);
  const day = parseDate(store.family.celebration);
  const born = elder && yearOf(elder.born);
  if (!day?.d || !born) return null;
  const date = new Date(day.y, day.m - 1, day.d);
  const age = day.y - born;
  return {
    elder,
    age,
    year: day.y,
    dateText: date.toLocaleDateString('ru', { day: 'numeric', month: 'long' }),
    daysLeft: Math.round((date - startOfDay(now)) / DAY),
    filled: Math.min(elder.memories.length, age), // сколько «годовых колец» уже заполнено воспоминаниями
  };
}

export function familyFacts(store) {
  const { people, generations, places } = store.stats();
  const earliest = Math.min(...store.people.map((p) => yearOf(p.born) ?? Infinity));
  const since = Number.isFinite(earliest) ? earliest : null;
  const facts = [
    [people, ['человек', 'человека', 'человек']],
    [generations, ['поколение', 'поколения', 'поколений']],
    [places, ['страна', 'страны', 'стран']],
    [since ? new Date().getFullYear() - since : 0, ['год истории', 'года истории', 'лет истории']],
  ];
  return { since, list: facts.filter(([n]) => n > 0).map(([n, forms]) => ({ n, label: plural(n, forms) })) };
}

// Ближайшие дни рождения и дни памяти (нужны день и месяц, одного года мало).
export function upcomingDates(store, now = new Date(), horizon = 90) {
  const today = startOfDay(now);
  const events = [];
  for (const p of store.people) {
    const source = parseDate(p.died ? p.died : p.born);
    if (!source?.d) continue;
    let date = new Date(today.getFullYear(), source.m - 1, source.d);
    if (date < today) date = new Date(today.getFullYear() + 1, source.m - 1, source.d);
    const inDays = Math.round((date - today) / DAY);
    if (inDays > horizon) continue;
    events.push({ person: p, type: p.died ? 'memorial' : 'birthday', date, inDays, years: date.getFullYear() - source.y });
  }
  return events.sort((a, b) => a.inDays - b.inDays);
}

const CHECKS = [
  { label: 'Без фотографии', has: (p) => p.photos.length > 0 },
  { label: 'Без истории и воспоминаний', has: (p) => Boolean(p.story.trim()) || p.memories.length > 0 },
  { label: 'Нет дня и месяца рождения', has: (p) => Boolean(parseDate(p.born)?.d) },
  { label: 'Не указан город', has: (p) => Boolean(p.place.trim()) },
];

export function completeness(store) {
  const total = store.people.length * CHECKS.length;
  const gaps = CHECKS.map((c) => ({ label: c.label, people: store.people.filter((p) => !c.has(p)) }));
  const missing = gaps.reduce((sum, g) => sum + g.people.length, 0);
  return {
    percent: total ? Math.round((100 * (total - missing)) / total) : 0,
    gaps: gaps.filter((g) => g.people.length),
  };
}

// Где живёт семья сейчас: страна — то, что после запятой в «Город, страна».
export function geography(store) {
  const byCountry = new Map();
  for (const p of store.people) {
    if (p.died || !p.place.includes(',')) continue;
    const country = p.place.split(',').pop().trim();
    if (country) byCountry.set(country, [...(byCountry.get(country) || []), p]);
  }
  return [...byCountry].map(([country, people]) => ({ country, people })).sort((a, b) => b.people.length - a.people.length);
}

const WORDS = {
  f: { about: 'о ней', inside: 'в ней', from: 'у неё', to: 'ей', withWhom: 'с ней' },
  m: { about: 'о нём', inside: 'в нём', from: 'у него', to: 'ему', withWhom: 'с ним' },
};
const QUESTIONS = [
  (w) => `Какая история ${w.about} первой приходит в голову?`,
  (w) => `Что ${w.inside} особенного — жест, привычка, любимое словечко?`,
  (w) => `Какое блюдо, запах или песня сразу напоминают ${w.about}?`,
  (w) => `Чему вы ${w.from} научились?`,
  (w) => `Какой самый смешной случай ${w.withWhom} вы помните?`,
  (w) => `За что вам хочется сказать ${w.to} спасибо?`,
];

// Каждую неделю — новый вопрос об одном из старших: повод вспомнить и записать.
export function questionOfWeek(store, now = new Date()) {
  const named = store.people.filter((p) => p.first).sort(store.byBirth);
  const elders = named.slice(0, Math.max(1, Math.ceil(named.length / 2)));
  if (!named.length) return null;
  // Номер недели считается по календарной дате, от понедельника: вопрос меняется у всех в один день,
  // в каком бы часовом поясе человек ни жил.
  const days = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(2024, 0, 1)) / DAY);
  const week = Math.floor(days / 7);
  const person = elders[week % elders.length];
  // вопрос сдвигается на один после полного круга по людям — так каждому достаются все вопросы
  const question = QUESTIONS[Math.floor(week / elders.length) % QUESTIONS.length];
  return { person, text: question(WORDS[person.gender] || WORDS.m) };
}
