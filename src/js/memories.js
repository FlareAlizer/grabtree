import { h, relTime } from './util.js';
import { store } from './store.js';
import { attempt } from './ui.js';
import { celebrate } from './decor.js';

// Недописанный текст переживает перерисовку (например, когда кто-то рядом поставил сердечко).
const drafts = new Map();

export function memoryItem(person, m) {
  return h('article', { class: 'memory' },
    m.prompt && h('p', { class: 'memory__prompt' }, m.prompt),
    h('p', { class: 'memory__text' }, m.text),
    h('footer', { class: 'memory__meta' },
      h('span', {}, `${m.by} · ${relTime(m.at)}`),
      m.canDelete && h('button', {
        class: 'link-btn', type: 'button', onclick: () => attempt(() => store.removeMemory(person.id, m.id)),
      }, 'удалить'),
      h('button', {
        class: `heart${m.liked ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(m.liked), 'aria-label': 'Спасибо за воспоминание',
        onclick: () => attempt(() => store.toggleHeart(person.id, m.id)),
      }, '♥', m.hearts > 0 && h('b', {}, m.hearts)),
    ),
  );
}

// prompt — вопрос, на который человек отвечает (сохраняется вместе с записью).
// onSubmit вызывается в момент отправки — до ответа сервера и перерисовки.
export function memoryForm(person, { prompt = '', placeholder, button = 'Поделиться', onSubmit } = {}) {
  const area = h('textarea', {
    class: 'input', maxlength: 2000,
    placeholder: placeholder || prompt || 'Что вы помните? Достаточно пары строк.',
    oninput: (e) => drafts.set(person.id, e.target.value),
  });
  area.value = drafts.get(person.id) || '';
  const send = h('button', { class: 'btn btn--primary', type: 'submit' }, button);

  return h('form', {
    class: 'memory-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const text = area.value.trim();
      if (!text) return area.focus();
      send.disabled = true;
      onSubmit?.();
      // черновик стираем только после того, как сервер принял запись
      const saved = await attempt(async () => {
        drafts.delete(person.id);
        try {
          return await store.addMemory(person.id, text, prompt);
        } catch (err) {
          drafts.set(person.id, text);
          throw err;
        }
      });
      send.disabled = false;
      if (saved) celebrate();
    },
  },
  area,
  h('div', { class: 'memory-form__row' },
    h('span', { class: 'field__hint' }, `Подпись: ${store.me}`),
    send,
  ));
}
