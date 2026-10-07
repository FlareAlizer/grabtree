import { h, s, fullName, portrait, plural, years, relTime } from './util.js';
import { store } from './store.js';
import { celebrationInfo, upcomingDates, completeness, geography, questionOfWeek } from './family.js';
import { memoryItem, memoryForm } from './memories.js';
import { attempt } from './ui.js';
import { drawRings } from './decor.js';

const LOG_TEXT = {
  person: (p) => `В древе ${p.gender === 'f' ? 'появилась' : 'появился'} ${fullName(p)}`,
  story: (p) => `Записана история: ${fullName(p)}`,
  photo: (p) => `Новые фотографии: ${fullName(p)}`,
  memory: (p) => `Новое воспоминание: ${fullName(p)}`,
};

// Набранное в полях переживает перерисовку страницы.
let whoFilter = '';
let surnameDraft = null;

function greeting(now) {
  const hour = now.getHours();
  const text = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : hour < 23 ? 'Добрый вечер' : 'Доброй ночи';
  return store.me ? `${text}, ${store.me}` : text;
}

const inDaysText = (n) => (n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} ${plural(n, ['день', 'дня', 'дней'])}`);

const tile = (cls, title, note, ...content) => h('section', { class: `tile ${cls}` },
  title && h('div', { class: 'tile__head' },
    h('h2', { class: 'tile__title' }, title),
    note && h('span', { class: 'tile__note' }, note),
  ),
  content,
);

const chip = (p, onclick) => h('button', { class: 'kin__chip', type: 'button', onclick }, portrait(p), fullName(p));

// api: { onOpen(id), onEdit(id), onAnswer(id, question), onTree(), onInvite(), onStart() }
export function renderHome(el, api) {
  const now = new Date();
  const me = store.byId(store.meId);

  el.replaceChildren(h('div', { class: 'home' },
    h('header', { class: 'home__head' },
      h('p', { class: 'eyebrow' }, now.toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' })),
      h('h1', { class: 'home__title' }, greeting(now)),
      h('p', { class: 'home__lead' },
        me ? [`В древе вы — ${fullName(me)}.`, h('button', { class: 'link-btn', type: 'button', onclick: () => store.setMeId(null) }, 'это не я')]
          : 'Здесь видно, чем живёт семья: ближайшие даты, новые ветви и воспоминания.',
        h('button', { class: 'btn btn--sm', type: 'button', onclick: api.onTree }, 'Открыть древо →'),
      ),
    ),
    h('div', { class: 'home__grid' },
      store.people.length === 0 && startTile(api),
      bookTile(api),
      !me && store.people.length > 0 && whoTile(),
      datesTile(api, now),
      newsTile(api),
      questionTile(api, now),
      gapsTile(api),
      geoTile(api),
      inviteTile(api),
      settingsTile(),
    ),
  ));
}

// Пустое древо: с чего начать.
function startTile(api) {
  return h('section', { class: 'tile tile--wide invite' },
    h('div', {},
      h('h2', { class: 'tile__title' }, 'Древо пока пустое'),
      h('p', { class: 'tile__text' }, 'Начните с одного человека — например, со старшего в роду. Остальных родные допишут сами.'),
    ),
    h('button', { class: 'btn btn--primary', type: 'button', onclick: api.onStart }, 'Добавить первого человека'),
  );
}

// Настройки видит только хранитель древа: название, праздник, кодовое слово, резервная копия.
function settingsTile() {
  if (!store.admin) return null;
  const fest = celebrationInfo(store);
  const input = h('input', {
    class: 'input', type: 'text', maxlength: 60, placeholder: 'Например, Листопадовых', 'aria-label': 'Фамилия семьи в родительном падеже',
    oninput: (e) => { surnameDraft = e.target.value; },
  });
  input.value = surnameDraft ?? store.family.surname;

  return tile('tile--wide settings', 'Настройки древа', 'видит только хранитель',
    h('form', {
      class: 'settings__row',
      onsubmit: async (e) => {
        e.preventDefault();
        const surname = input.value;
        if (await attempt(() => store.setFamily({ surname }))) surnameDraft = null;
      },
    },
    h('span', { class: 'settings__label' }, 'Название: «Древо семьи …»'),
    input,
    h('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    h('p', { class: 'tile__text' }, fest
      ? [`Книгу воспоминаний семья собирает ко дню рождения: ${fullName(fest.elder)}, ${fest.dateText}. `,
        h('button', { class: 'link-btn', type: 'button', onclick: () => attempt(() => store.setFamily({ elderId: null })) }, 'убрать')]
      : 'Чтобы семья собирала книгу воспоминаний к празднику, откройте карточку именинника и нажмите «Собрать книгу ко дню рождения».'),
    h('p', { class: 'tile__text' }, 'Кодовое слово семьи: ', h('b', {}, store.inviteCode), '. Его же несёт ссылка из «Позовите родных».'),
    h('p', { class: 'tile__text' }, h('a', { class: 'link-btn', href: '/api/export', download: '' }, 'Скачать резервную копию древа')),
  );
}

// Книга к празднику: каждое воспоминание о старейшине зажигает одно годовое кольцо.
function bookTile(api) {
  const fest = celebrationInfo(store);
  if (!fest) return null;
  const { elder, age, filled, daysLeft } = fest;
  const rings = s('svg', { class: 'book__rings', viewBox: '-520 -520 1040 1040', 'aria-hidden': 'true' });
  drawRings(rings, age, filled);
  const left = daysLeft > 0
    ? `До праздника ${daysLeft} ${plural(daysLeft, ['день', 'дня', 'дней'])}.`
    : daysLeft === 0 ? 'Праздник сегодня!' : '';
  const latest = [...elder.memories].reverse().slice(0, 2);

  return h('section', { class: 'tile tile--wide book' },
    h('div', { class: 'book__progress' },
      rings,
      h('p', { class: 'book__count' }, filled, h('small', {}, ` из ${age}`)),
      h('p', { class: 'book__caption' }, plural(filled, ['кольцо уже светится', 'кольца уже светятся', 'колец уже светятся'])),
    ),
    h('div', { class: 'book__body' },
      h('p', { class: 'eyebrow' }, `Подарок к ${fest.dateText}`),
      h('h2', { class: 'book__title' }, `Книга к ${age}-летию`),
      h('p', { class: 'book__lead' }, `${age} ${plural(age, ['годовое кольцо', 'годовых кольца', 'годовых колец'])} — ${age} ${plural(age, ['тёплое слово', 'тёплых слова', 'тёплых слов'])}. Каждое воспоминание или поздравление зажигает одно кольцо, а в день рождения книгу целиком получит ${fullName(elder)}. ${left}`),
      memoryForm(elder, { placeholder: 'Что вы хотите сказать или вспомнить? Достаточно пары строк.', button: 'Добавить в книгу' }),
      latest.length > 0 && h('div', { class: 'memories' }, latest.map((m) => memoryItem(elder, m))),
      elder.memories.length > latest.length && h('button', { class: 'btn btn--sm', type: 'button', onclick: () => api.onOpen(elder.id) },
        `Вся книга: ${elder.memories.length} ${plural(elder.memories.length, ['запись', 'записи', 'записей'])} →`),
    ),
  );
}

function whoTile() {
  const list = h('div', { class: 'kin__list' });
  const draw = () => {
    const q = whoFilter.trim().toLowerCase();
    const found = store.people.filter((p) => !p.died && fullName(p).toLowerCase().includes(q)).slice(0, 8);
    list.replaceChildren(...(found.length
      ? found.map((p) => chip(p, () => { whoFilter = ''; store.setMeId(p.id); }))
      : [h('span', { class: 'tile__note' }, 'Вас пока нет в древе — добавьте себя на вкладке «Древо».')]));
  };
  const input = h('input', {
    class: 'input who__input', type: 'search', placeholder: 'Начните вводить своё имя', 'aria-label': 'Найти себя',
    oninput: (e) => { whoFilter = e.target.value; draw(); },
  });
  input.value = whoFilter;
  draw();
  return tile('tile--wide who', 'Кто вы в древе?', null,
    h('p', { class: 'tile__text' }, 'Отметьте себя — и под каждым человеком появится подпись, кем он вам приходится: бабушка, двоюродный брат, жена дяди.'),
    input, list);
}

function datesTile(api, now) {
  const events = upcomingDates(store, now).slice(0, 5);
  const rows = events.map((e) => {
    const sub = e.type === 'memorial'
      ? `день памяти · ${years(e.years)}`
      : `${e.inDays === 0 ? 'исполняется' : 'исполнится'} ${years(e.years)}`;
    return h('button', {
      class: `row${e.inDays === 0 ? ' is-today' : ''}${e.type === 'memorial' ? ' is-memorial' : ''}`, type: 'button',
      onclick: () => api.onOpen(e.person.id),
    },
    h('span', { class: 'datebox' }, h('b', {}, e.date.getDate()), h('small', {}, e.date.toLocaleDateString('ru', { month: 'short' }).replace('.', ''))),
    h('span', {}, h('span', { class: 'row__title' }, fullName(e.person)), h('span', { class: 'row__sub' }, sub)),
    h('span', { class: 'row__aside' }, inDaysText(e.inDays)));
  });
  return tile('', 'Ближайшие даты', 'на три месяца вперёд',
    rows.length ? h('div', { class: 'rows' }, rows)
      : h('p', { class: 'tile__text' }, 'Чтобы здесь появились дни рождения, укажите у родных день и месяц — одного года мало.'));
}

function newsTile(api) {
  const rows = store.log.filter((entry) => store.byId(entry.personId) && LOG_TEXT[entry.type]).slice(0, 5).map((entry) => {
    const p = store.byId(entry.personId);
    return h('button', { class: 'row', type: 'button', onclick: () => api.onOpen(p.id) },
      portrait(p),
      h('span', {}, h('span', { class: 'row__title' }, LOG_TEXT[entry.type](p)), h('span', { class: 'row__sub' }, `${entry.by} · ${relTime(entry.at)}`)),
      h('span', { class: 'row__aside' }, '→'));
  });
  return tile('', 'Что нового', null,
    rows.length ? h('div', { class: 'rows rows--news' }, rows)
      : h('p', { class: 'tile__text' }, 'Пока тихо. Допишите ветвь или воспоминание — и родные увидят это здесь.'));
}

function questionTile(api, now) {
  const q = questionOfWeek(store, now);
  if (!q) return null;
  return h('section', { class: 'tile tile--wide question' },
    h('div', { class: 'question__main' },
      h('p', { class: 'eyebrow' }, 'Вопрос недели'),
      h('p', { class: 'question__text' }, q.text),
      chip(q.person, () => api.onOpen(q.person.id)),
    ),
    h('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: () => api.onAnswer(q.person.id, q.text) }, 'Ответить'),
  );
}

// Древо тем полнее, чем больше родных в него заглянуло.
function inviteTile(api) {
  return h('section', { class: 'tile tile--wide invite' },
    h('div', {},
      h('h2', { class: 'tile__title' }, 'Позовите родных'),
      h('p', { class: 'tile__text' }, 'Отправьте приглашение в семейный чат: каждый допишет свою ветвь и расскажет то, чего не знает больше никто.'),
    ),
    h('button', { class: 'btn', type: 'button', onclick: api.onInvite }, 'Скопировать приглашение'),
  );
}

function gapsTile(api) {
  if (!store.people.length) return null;
  const { percent, gaps } = completeness(store);
  return tile('', 'Чего не хватает', `заполнено на ${percent}%`,
    h('div', { class: 'meter', role: 'img', 'aria-label': `Древо заполнено на ${percent}%` }, h('i', { style: `width:${percent}%` })),
    gaps.length === 0 && h('p', { class: 'tile__text' }, 'Всё заполнено. Редкий случай — поздравляем!'),
    gaps.map((gap) => h('div', { class: 'gap' },
      h('p', { class: 'gap__label' }, gap.label, h('span', {}, gap.people.length)),
      h('div', { class: 'kin__list' },
        gap.people.slice(0, 3).map((p) => chip(p, () => api.onEdit(p.id))),
        gap.people.length > 3 && h('span', { class: 'gap__more' }, `и ещё ${gap.people.length - 3}`),
      ),
    )),
  );
}

function geoTile(api) {
  const places = geography(store);
  if (!places.length) return null;
  return tile('', 'Где мы живём', `${places.length} ${plural(places.length, ['страна', 'страны', 'стран'])}`,
    h('div', { class: 'geo' }, places.map(({ country, people }) => h('div', { class: 'geo__row' },
      h('span', {},
        h('span', { class: 'geo__name' }, country),
        h('span', { class: 'geo__count' }, `${people.length} ${plural(people.length, ['человек', 'человека', 'человек'])}`),
      ),
      h('span', { class: 'geo__faces' }, people.slice(0, 6).map((p) => h('button', {
        class: 'face', type: 'button', title: fullName(p), 'aria-label': fullName(p), onclick: () => api.onOpen(p.id),
      }, portrait(p)))),
    ))));
}
