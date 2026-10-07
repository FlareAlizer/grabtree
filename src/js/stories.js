import { h, fullName, lifespan, portrait } from './util.js';
import { store } from './store.js';

const EXCERPT = 300;

// Начало рассказа для ленты: режем по границе слова, а если пробела рядом нет — просто по длине.
export function excerpt(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= EXCERPT) return flat;
  const cut = flat.lastIndexOf(' ', EXCERPT);
  return `${flat.slice(0, cut > EXCERPT / 2 ? cut : EXCERPT)}…`;
}

// api: { onRead(id), onWrite(id) }
export function renderStories(el, api) {
  const told = store.people.filter((p) => p.story.trim());
  const waiting = store.people.filter((p) => !p.story.trim());

  el.replaceChildren(h('div', { class: 'stories' },
    h('p', { class: 'eyebrow' }, 'Семейные рассказы'),
    h('h1', { class: 'stories__title' }, 'Истории'),
    h('p', { class: 'stories__lead' }, 'То, что обычно рассказывают за столом и что легко потерять. Запишите, пока есть у кого спросить.'),

    store.people.length === 0 && h('p', { class: 'stories__lead' }, 'Здесь появятся рассказы, как только в древе будут люди.'),

    told.map((p) => h('button', { class: 'story-card', type: 'button', onclick: () => api.onRead(p.id) },
      portrait(p),
      h('span', {},
        h('span', { class: 'story-card__name' }, fullName(p)),
        h('span', { class: 'story-card__meta' }, h('br'), [lifespan(p), p.place].filter(Boolean).join(' · ')),
        h('p', { class: 'story-card__text' }, excerpt(p.story)),
        h('span', { class: 'story-card__more' }, 'Читать полностью →'),
      ),
    )),

    waiting.length > 0 && h('div', { class: 'waiting' },
      h('h2', { class: 'waiting__title' }, 'Ждут своих историй'),
      h('p', { class: 'waiting__lead' }, 'Нажмите на имя, чтобы написать несколько строк.'),
      h('div', { class: 'kin__list' },
        waiting.map((p) => h('button', { class: 'kin__chip', type: 'button', onclick: () => api.onWrite(p.id) }, portrait(p), fullName(p))),
      ),
    ),
  ));
}
