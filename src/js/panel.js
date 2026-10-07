import { h, fullName, formatDate, lifespan, ageOf, years, portrait, resizeImage } from './util.js';
import { store } from './store.js';
import { toast, attempt } from './ui.js';
import { kinship } from './kinship.js';
import { celebrationInfo, nextBirthday } from './family.js';
import { memoryItem, memoryForm } from './memories.js';

const REL_TITLES = { child: 'Новый ребёнок', partner: 'Супруг или супруга', parent: 'Родитель' };
const EDITABLE = ['first', 'last', 'maiden', 'gender', 'born', 'died', 'place', 'story', 'photos'];

// api: { onNavigate(id), onClose(), onSaved(id, isNew), onRemoved(), onReroot(id), onShare(id) }
export function createPanel(el, api) {
  let st = { mode: 'closed' };

  // Несохранённая правка: поля формы отличаются от тех, с которыми её открыли.
  const isDirty = () => (st.mode === 'edit' || st.mode === 'new')
    && EDITABLE.some((key) => JSON.stringify(st.draft[key]) !== JSON.stringify(st.original[key]));
  // Уйти с формы можно всегда, но если в ней есть несохранённое — только после подтверждения.
  const mayLeave = () => !isDirty() || window.confirm('Изменения не сохранены. Закрыть без сохранения?');

  // Все четыре перехода возвращают false, если человек решил остаться в форме.
  // prompt — вопрос недели: открываем карточку сразу на форме воспоминания
  function open(id, prompt = '') {
    if (!mayLeave()) return false;
    st = { mode: 'view', id, prompt };
    render();
    return true;
  }
  function close() {
    if (!mayLeave()) return false;
    st = { mode: 'closed' };
    render();
    return true;
  }
  function edit(id) {
    if (!mayLeave()) return false;
    const original = structuredClone(store.byId(id));
    st = { mode: 'edit', id, original, draft: structuredClone(original) };
    render();
    return true;
  }
  function create(rel) {
    if (!mayLeave()) return false;
    const anchor = rel && store.byId(rel.id);
    const draft = { first: '', last: '', maiden: '', gender: 'f', born: '', died: '', place: '', story: '', photos: [] };
    if (anchor && rel.type === 'partner') draft.gender = anchor.gender === 'f' ? 'm' : 'f';
    st = { mode: 'new', rel, draft, original: structuredClone(draft) };
    render();
    return true;
  }

  function render() {
    if (st.mode === 'view' && !store.byId(st.id)) st = { mode: 'closed' };
    el.classList.toggle('is-open', st.mode !== 'closed');
    if (st.mode === 'closed') return el.replaceChildren();
    // при обновлении той же карточки сохраняем место, до которого человек дочитал
    const shown = el.firstElementChild;
    const keepScroll = shown && st.mode === 'view' && shown.dataset.for === st.id ? shown.scrollTop : 0;
    const body = st.mode === 'view' ? viewPerson(store.byId(st.id)) : form();
    const scroller = h('div', { class: 'panel__scroll', 'data-for': st.mode === 'view' ? st.id : null }, body);
    el.replaceChildren(scroller);
    scroller.scrollTop = keepScroll;
    if (st.mode !== 'view') return el.querySelector('input')?.focus();
    // к форме ответа подводим один раз, а не при каждом обновлении карточки
    if (st.prompt && !st.promptShown) {
      st.promptShown = true;
      const area = el.querySelector('.memory-form textarea');
      area?.scrollIntoView({ block: 'center' });
      area?.focus({ preventScroll: true });
    }
  }

  const bar = (title, onBack) => h('div', { class: 'panel__bar' },
    onBack ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Назад', onclick: onBack }, '←') : h('span'),
    h('span', { class: 'panel__bar-title' }, title),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onclick: api.onClose }, '×'),
  );

  // ── Просмотр ─────────────────────────────────────────────
  function viewPerson(p) {
    const age = ageOf(p);
    const dates = p.died
      ? [lifespan(p), age != null && years(age)]
      : [p.born && `род. ${formatDate(p.born)}`, age != null && years(age)];
    const isMe = store.meId === p.id;
    const kin = store.meId && !isMe ? kinship(store, store.meId, p.id) : null;
    // Хранитель выбирает, к чьему дню рождения семья собирает книгу воспоминаний.
    const birthday = store.admin && !p.died && p.id !== store.family.elderId ? nextBirthday(p.born) : null;

    return [
      bar(''),
      h('div', { class: `person-hero${p.died ? ' is-late' : ''}` },
        portrait(p),
        (isMe || kin) && h('p', { class: 'person-hero__kin' }, isMe ? 'Это вы' : `Для вас — ${kin}`),
        h('h2', { class: 'person-hero__name' }, fullName(p)),
        p.maiden && h('p', { class: 'person-hero__maiden' }, `урожд. ${p.maiden}`),
        h('p', { class: 'person-hero__dates' }, dates.filter(Boolean).join(' · ')),
        p.place && h('p', { class: 'person-hero__place' }, p.place),
        h('div', { class: 'person-hero__actions' },
          h('button', { class: 'btn btn--primary', type: 'button', onclick: () => edit(p.id) }, 'Редактировать'),
          !isMe && h('button', {
            class: 'btn', type: 'button',
            onclick: () => { store.setMeId(p.id); toast('Готово: у каждого в древе подписано, кем он вам приходится'); },
          }, 'Это я'),
        ),
        h('p', { class: 'person-hero__links' },
          h('button', { class: 'link-btn', type: 'button', onclick: () => api.onReroot(p.id) }, 'Показать ветвь на древе'),
          h('button', { class: 'link-btn', type: 'button', onclick: () => api.onShare(p.id) }, 'Скопировать ссылку'),
          birthday && h('button', {
            class: 'link-btn', type: 'button',
            onclick: () => attempt(() => store.setFamily({ elderId: p.id, celebration: birthday })),
          }, 'Собрать книгу ко дню рождения'),
        ),
      ),

      section('История', null, p.story
        ? h('div', { class: 'story' }, p.story.split(/\n{2,}/).map((para) => h('p', {}, para)))
        : h('div', { class: 'empty' },
          'Историю пока никто не записал. Каким вы помните этого человека?',
          h('br'),
          h('button', { class: 'btn btn--sm', type: 'button', onclick: () => edit(p.id) }, 'Написать рассказ'),
        )),

      memoriesSection(p),

      section('Фотографии', p.photos.length || null, h('div', { class: 'gallery' },
        p.photos.map((src) => h('div', { class: 'gallery__item' }, h('img', { src, alt: `Фото: ${fullName(p)}`, loading: 'lazy' }))),
        uploadTile((urls) => attempt(() => store.addPhotos(p.id, urls))),
      )),

      section('Семья', null, h('div', { class: 'kin' },
        kinRow('Родители', store.parentsOf(p.id), p.parents.length < 2 && ['+ родитель', 'parent', p.id]),
        kinRow('В браке с', store.partnersOf(p.id), ['+ супруг(а)', 'partner', p.id]),
        kinRow('Дети', store.childrenOf(p.id), ['+ ребёнок', 'child', p.id]),
        kinRow('Братья и сёстры', store.siblingsOf(p.id)),
      )),

      p.addedBy && h('p', { class: 'panel__foot' }, `Добавил(а): ${p.addedBy}`),
    ];
  }

  // У старейшины воспоминания — это книга к празднику: по записи на каждый год.
  function memoriesSection(p) {
    const fest = p.id === store.family.elderId ? celebrationInfo(store) : null;
    const list = [...p.memories].reverse();
    return section(
      fest ? `Книга к ${fest.age}-летию` : 'Воспоминания',
      fest ? `${fest.filled} из ${fest.age}` : (list.length || null),
      [
        list.length > 0 && h('div', { class: 'memories' }, list.map((m) => memoryItem(p, m))),
        // вопрос относится только к одному ответу: следующая запись в этой карточке уже без него
        memoryForm(p, { prompt: st.prompt, button: fest ? 'Добавить в книгу' : 'Поделиться', onSubmit: () => { st.prompt = ''; } }),
      ],
    );
  }

  const section = (title, count, content) => h('section', { class: 'section' },
    h('div', { class: 'section__head' },
      h('h3', { class: 'section__title' }, title),
      count && h('span', { class: 'section__count' }, count),
    ),
    content,
  );

  function kinRow(label, people, add) {
    if (!people.length && !add) return null;
    return h('div', { class: 'kin__row' },
      h('span', { class: 'kin__label' }, label),
      h('div', { class: 'kin__list' },
        people.map((q) => h('button', { class: 'kin__chip', type: 'button', onclick: () => api.onNavigate(q.id) }, portrait(q), fullName(q))),
        add && h('button', { class: 'kin__add', type: 'button', onclick: () => create({ type: add[1], id: add[2] }) }, add[0]),
      ),
    );
  }

  // Плитка «добавить фото»: ужимает снимки, отправляет на сервер и отдаёт их адреса.
  function uploadTile(onPhotos) {
    const caption = h('span', {}, 'Добавить фото');
    const tile = h('label', { class: 'gallery__add' },
      h('b', {}, '+'), caption,
      h('input', {
        type: 'file', accept: 'image/*', multiple: true,
        onchange: async (e) => {
          const files = [...e.target.files];
          if (!files.length) return;
          e.target.disabled = true;
          tile.classList.add('is-busy');
          const urls = [];
          try {
            for (const [i, file] of files.entries()) {
              caption.textContent = files.length > 1 ? `Загружаю ${i + 1} из ${files.length}…` : 'Загружаю…';
              urls.push(await store.uploadPhoto(await resizeImage(file)));
            }
          } catch (err) {
            toast(err.status != null ? err.message : 'Не получилось прочитать фото. Подойдут обычные снимки JPEG и PNG.');
          }
          if (urls.length) await onPhotos(urls);
          // если плитку не перерисовали (правка ещё открыта или была ошибка) — возвращаем её в строй
          caption.textContent = 'Добавить фото';
          tile.classList.remove('is-busy');
          e.target.disabled = false;
          e.target.value = '';
        },
      }),
    );
    return tile;
  }

  // ── Форма: новый человек или правка ──────────────────────
  function form() {
    const { draft, rel } = st;
    const isNew = st.mode === 'new';
    const anchor = rel && store.byId(rel.id);

    const text = (key, label, opts = {}) => {
      const input = h(opts.area ? 'textarea' : 'input', {
        class: 'input', type: opts.area ? null : 'text', placeholder: opts.placeholder, maxlength: opts.max || 80,
        oninput: (e) => { draft[key] = e.target.value; e.target.closest('.field').classList.remove('is-invalid'); },
      });
      input.value = draft[key] || '';
      return h('label', { class: 'field', 'data-key': key },
        h('span', { class: 'field__label' }, label), input,
        opts.hint && h('span', { class: 'field__hint' }, opts.hint),
      );
    };

    const genderBtn = (value, label) => h('button', {
      type: 'button', class: draft.gender === value ? 'is-active' : '',
      onclick: (e) => {
        draft.gender = value;
        e.target.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === e.target));
      },
    }, label);

    const gallery = h('div', { class: 'gallery' });
    const drawGallery = () => gallery.replaceChildren(
      ...draft.photos.map((src, i) => h('div', { class: 'gallery__item' },
        h('img', { src, alt: '' }),
        i === 0 && h('span', { class: 'gallery__tag' }, 'портрет'),
        h('button', { class: 'gallery__remove', type: 'button', 'aria-label': 'Убрать фото', onclick: () => { draft.photos.splice(i, 1); drawGallery(); } }, '×'),
      )),
      uploadTile((urls) => { draft.photos.push(...urls); drawGallery(); }),
    );
    drawGallery();

    const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, isNew ? 'Добавить в древо' : 'Сохранить');
    const save = async (e) => {
      e.preventDefault();
      if (!draft.first.trim()) {
        const field = el.querySelector('[data-key="first"]');
        field.classList.add('is-invalid');
        field.querySelector('input').focus();
        return;
      }
      submit.disabled = true;
      const id = await attempt(async () => {
        if (isNew) return store.addPerson(draft, rel);
        // На сервер уходят только изменённые поля — чужие правки остальных полей не затираются.
        const patch = Object.fromEntries(EDITABLE.filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(st.original[key])).map((key) => [key, draft[key]]));
        if (Object.keys(patch).length) await store.updatePerson(st.id, patch);
        return st.id;
      });
      submit.disabled = false;
      if (!id) return;
      st.original = structuredClone(draft); // сохранено — уходить с формы можно без вопросов
      api.onSaved(id, isNew);
    };

    let armed = false;
    const remove = h('button', {
      class: 'btn btn--danger', type: 'button',
      onclick: async () => {
        if (!armed) { armed = true; remove.textContent = 'Точно удалить?'; return; }
        if (!(await attempt(() => store.removePerson(st.id)))) return;
        st = { mode: 'closed' };
        api.onRemoved();
      },
    }, 'Удалить');

    return [
      bar(isNew ? 'Новая ветвь' : 'Правка', isNew ? (anchor ? () => open(anchor.id) : null) : () => open(st.id)),
      h('h2', { class: 'form__title' }, isNew ? (REL_TITLES[rel?.type] || 'Новый человек') : fullName(draft)),
      anchor && h('p', { class: 'form__sub' }, `Ветвь от: ${fullName(anchor)}`),
      h('form', { class: 'form', novalidate: true, onsubmit: save },
        h('div', { class: 'form__pair' },
          text('first', 'Имя', { hint: 'Обязательно' }),
          text('last', 'Фамилия'),
        ),
        h('div', { class: 'form__pair' },
          text('maiden', 'Фамилия при рождении', { placeholder: 'если менялась' }),
          h('div', { class: 'field' },
            h('span', { class: 'field__label' }, 'Пол'),
            h('div', { class: 'segmented' }, genderBtn('f', 'Женский'), genderBtn('m', 'Мужской')),
          ),
        ),
        h('div', { class: 'form__pair' },
          text('born', 'Дата рождения', { placeholder: '12.03.1950 или 1950', max: 20 }),
          text('died', 'Дата смерти', { placeholder: 'если человека уже нет', max: 20 }),
        ),
        text('place', 'Где живёт или жил(а)', { placeholder: 'Город, страна', max: 120 }),
        h('div', { class: 'field' },
          h('span', { class: 'field__label' }, 'Фотографии'),
          gallery,
          h('span', { class: 'field__hint' }, 'Первая фотография станет портретом на древе.'),
        ),
        text('story', 'История', { area: true, max: 20000, placeholder: 'Каким был этот человек? Что о нём рассказывали в семье?', hint: 'Можно дописать позже — и не только вам.' }),
        h('div', { class: 'form__actions' },
          submit,
          // удалить может тот, кто добавил человека, или хранитель древа
          !isNew && st.original.canDelete && remove,
        ),
      ),
    ];
  }

  return {
    open, close, edit, create,
    refresh: () => { if (st.mode === 'view') render(); },
    get isEditing() { return st.mode === 'edit' || st.mode === 'new'; },
    get isDirty() { return isDirty(); },
  };
}
