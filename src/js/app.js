import { h, fullName, lifespan, portrait } from './util.js';
import { store } from './store.js';
import { toast } from './ui.js';
import { createTreeView } from './tree-view.js';
import { createPanel } from './panel.js';
import { renderStories } from './stories.js';
import { renderHome } from './home.js';
import { initCover } from './cover.js';
import { openPoster } from './poster.js';
import { celebrate } from './decor.js';
import { celebrationInfo, familyFacts } from './family.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['home', 'tree', 'stories'];

let selectedId = null;
let view = 'tree';

// ── Ссылки и приглашения ────────────────────────────────────
const siteUrl = () => `${location.origin}${location.pathname}`;

// Ссылка-приглашение несёт кодовое слово после #invite=. Забираем его и сразу убираем из адресной строки.
function takeInvite() {
  const match = location.hash.match(/^#invite=(.+)$/);
  if (!match) return '';
  history.replaceState(null, '', location.pathname);
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

// Копирование в буфер. navigator.clipboard есть только на https и localhost, поэтому на случай
// обычного http — старый способ через скрытое поле, а если не вышло и так — показываем текст, чтобы скопировать руками.
async function copy(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    return toast(done);
  } catch { /* пробуем запасной способ */ }
  const field = h('textarea', { style: 'position:fixed;top:0;left:0;opacity:0', readonly: true });
  field.value = text;
  document.body.append(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch { /* copied остаётся false */ }
  field.remove();
  if (copied) toast(done);
  else window.prompt('Скопируйте текст вручную:', text);
}

function inviteText() {
  const fest = celebrationInfo(store);
  const { surname } = store.family;
  const occasion = fest && fest.daysLeft >= 0 ? ` к ${fest.age}-летию (${fest.elder.first}, ${fest.dateText})` : '';
  return `Собираем ${surname ? `древо семьи ${surname}` : 'семейное древо'}${occasion}. Загляни, найди себя и допиши свою ветвь — фото и пара строк воспоминаний очень помогут: ${store.inviteLink()}`;
}

// ── Древо, панель, разделы ──────────────────────────────────
const tree = createTreeView($('view-tree'), {
  onSelect: (id) => select(id),
  onAdd: (type, id) => panel.create({ type, id }),
  onReroot: reroot,
  onStart: () => panel.create(null),
  onPoster: () => openPoster(tree.snapshot(), posterFooter()),
});

const panel = createPanel($('panel'), {
  onNavigate: (id) => select(id),
  onClose: deselect,
  onReroot: reroot,
  onShare: (id) => copy(`${siteUrl()}#/person/${id}`, 'Ссылка скопирована — отправьте её родным'),
  onSaved(id, isNew) {
    select(id);
    if (!isNew) return;
    toast(`${fullName(store.byId(id))} — теперь в древе`);
    celebrate();
  },
  onRemoved() {
    deselect();
    toast('Человек удалён из древа');
  },
});

function select(id, prompt = '') {
  // panel.open вернёт false, если в панели несохранённая правка и человек решил её не бросать
  if (!store.byId(id) || !panel.open(id, prompt)) return;
  selectedId = id;
  syncHash();
  if (view !== 'tree') return;
  // Человек вне показанной ветви (например, родители супруга) — переключаемся на его ветвь.
  if (!tree.focus(id)) {
    store.setRoot(store.topAncestor(id));
    tree.focus(id);
  }
  tree.setSelected(id);
}

function deselect() {
  if (!panel.close()) return;
  selectedId = null;
  tree.setSelected(null);
  syncHash();
}

function reroot(id) {
  const target = store.byId(id)?.parents.length ? store.topAncestor(id) : id;
  store.setRoot(target === store.autoRoot() ? null : target);
  showView('tree');
}

function showView(next) {
  view = next;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.view === next));
  for (const name of VIEWS) $(`view-${name}`).hidden = name !== next;
  if (next === 'tree') {
    tree.render();
    if (selectedId) tree.focus(selectedId);
  }
  syncHash();
}

function posterFooter() {
  const fest = celebrationInfo(store);
  return [
    familyFacts(store).list.map(({ n, label }) => `${n} ${label}`).join(' · '),
    fest && `Собрано всей семьёй к ${fest.age}-летию: ${fullName(fest.elder)} · ${fest.dateText} ${fest.year}`,
  ].filter(Boolean);
}

function renderAll() {
  const { surname } = store.family;
  document.title = surname ? `Древо семьи ${surname}` : 'Семейное древо';
  $('brand-surname').textContent = surname ? `семьи ${surname}` : '';
  document.documentElement.dataset.theme = store.theme;
  $('theme-btn').textContent = store.theme === 'night' ? '☀' : '☾';

  tree.render();
  tree.setSelected(selectedId);
  renderHome($('view-home'), {
    onOpen: (id) => select(id),
    onEdit: (id) => { if (panel.edit(id)) selectedId = id; },
    onAnswer: (id, question) => select(id, question),
    onTree: () => showView('tree'),
    onInvite: () => copy(inviteText(), 'Приглашение скопировано — вставьте его в семейный чат'),
    onStart: () => { showView('tree'); panel.create(null); },
  });
  renderStories($('view-stories'), {
    onRead: (id) => select(id),
    onWrite: (id) => { if (panel.edit(id)) selectedId = id; },
  });
  panel.refresh();

  const branch = store.byId(store.rootId);
  $('branch-chip').hidden = !branch;
  if (branch) $('branch-chip').textContent = `Ветвь: ${fullName(branch)} · показать всё древо`;
  $('me-chip').textContent = store.me ? `Вы — ${store.me}` : 'Представиться';
}

// ── Адреса: #/tree, #/home, #/stories, #/person/<id> ────────
function syncHash() {
  const target = selectedId ? `#/person/${selectedId}` : `#/${view}`;
  if (location.hash !== target) history.replaceState(null, '', target);
}

function applyHash() {
  const [, section, id] = location.hash.match(/^#\/(\w+)(?:\/([\w-]+))?$/) || [];
  if (section === 'person' && store.byId(id)) {
    showView('tree');
    select(id);
  } else {
    showView(VIEWS.includes(section) ? section : view);
  }
}

// ── Шапка: обложка, разделы, оформление, поиск ──────────────
const cover = initCover(takeInvite());
$('brand').addEventListener('click', () => cover.show());
$('me-chip').addEventListener('click', () => cover.show(true));
$('theme-btn').addEventListener('click', () => store.setTheme(store.theme === 'night' ? 'paper' : 'night'));
$('branch-chip').addEventListener('click', () => store.setRoot(null));
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));

const results = $('search-results');
$('search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  results.hidden = !q;
  if (!q) return;
  const found = store.people.filter((p) => `${fullName(p)} ${p.maiden}`.toLowerCase().includes(q)).slice(0, 6);
  results.replaceChildren(...(found.length
    ? found.map((p) => h('li', {}, h('button', {
      class: 'search__item', type: 'button',
      onclick: () => { e.target.value = ''; results.hidden = true; showView('tree'); select(p.id); },
    }, portrait(p), fullName(p), h('small', {}, lifespan(p)))))
    : [h('li', { class: 'search__empty' }, 'Никого не нашли')]));
});
document.addEventListener('click', (e) => { if (!e.target.closest('.search')) results.hidden = true; });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  results.hidden = true;
  if (!panel.isEditing) deselect();
});
addEventListener('hashchange', applyHash);

// ── Обновления ──────────────────────────────────────────────
// Пока человек печатает, чужие правки не перерисовывают страницу под руками — применяются, когда он закончит.
let booting = true;
let entered = false;
let deferred = false;
const typing = () => Boolean(document.activeElement?.matches('textarea, input:not([type="file"]):not(#search)'));

store.subscribe(({ remote }) => {
  if (!store.authorized) return cover.show(); // сессия закончилась — снова спрашиваем кодовое слово
  if (remote && typing()) {
    deferred = true;
    return;
  }
  renderAll();
  if (!entered) {
    entered = true;
    // Кто возвращается — сначала видит, что нового в семье; кто вошёл впервые — само древо.
    if (booting && !location.hash) view = 'home';
    applyHash(); // а если пришли по ссылке — открываем то, на что она вела
    cover.hide(); // на случай, когда связь появилась уже после неудачного запуска
  }
});

// Отложенное обновление применяется, когда человек закончил печатать. Но не посреди нажатия:
// клик по «Поделиться» сначала уводит фокус из поля, и перерисовка в этот момент подменила бы кнопку под пальцем.
let pressing = false;
function flushDeferred() {
  if (!deferred || pressing || typing()) return;
  deferred = false;
  renderAll();
}
document.addEventListener('pointerdown', () => { pressing = true; }, true);
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, () => {
    pressing = false;
    setTimeout(flushDeferred); // после того как сработает сам клик
  }, true);
}
document.addEventListener('focusout', () => setTimeout(flushDeferred));

// Закрытие вкладки с несохранённой правкой — с предупреждением браузера.
addEventListener('beforeunload', (e) => {
  if (!panel.isDirty) return;
  e.preventDefault();
  e.returnValue = ''; // для браузеров, которые не понимают один preventDefault
});

// ── Запуск ──────────────────────────────────────────────────
try {
  await store.init();
  if (store.authorized) {
    cover.hide();
  } else {
    renderAll();
    cover.show();
  }
} catch (err) {
  renderAll();
  cover.show();
  $('enter-error').textContent = err.message;
}
booting = false;
