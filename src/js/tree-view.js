import { h, s, fullName, lifespan, portrait, roman } from './util.js';
import { store } from './store.js';
import { layoutTree, CARD_W, CARD_H } from './layout.js';
import { kinship } from './kinship.js';
import { celebrationInfo, familyFacts } from './family.js';
import { foliage, branchLeaves, ribbon } from './decor.js';

// Поля вокруг карточек: слева подписи поколений, сверху лента-заголовок.
const PAD = { left: 170, right: 44, top: 196, bottom: 48 };
const RIBBON_W = 720;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.6;
const READABLE_ZOOM = 0.5;

const ADD_LABELS = { parent: 'Добавить родителя', partner: 'Добавить супруга(у)', child: 'Добавить ребёнка' };

// api: { onSelect(id), onAdd(type, id), onReroot(id), onStart(), onPoster() }
export function createTreeView(root, api) {
  const stage = h('div', { class: 'tree-stage' });
  const viewport = h('div', { class: 'tree-viewport' }, stage);
  const zoomLabel = h('span', { class: 'tree-tools__zoom' }, '100%');
  const tools = h('div', { class: 'tree-tools' },
    h('button', { type: 'button', 'aria-label': 'Отдалить', onclick: () => zoomBy(1 / 1.25) }, '−'),
    zoomLabel,
    h('button', { type: 'button', 'aria-label': 'Приблизить', onclick: () => zoomBy(1.25) }, '+'),
    h('span', { class: 'tree-tools__sep' }),
    h('button', { type: 'button', onclick: () => fit(true, true) }, 'Всё древо'),
    h('button', {
      type: 'button', title: 'Перевернуть: корни внизу или вверху', 'aria-label': 'Перевернуть древо',
      onclick: () => store.setFlip(!store.flip),
    }, '⇅'),
    h('span', { class: 'tree-tools__sep' }),
    h('button', { type: 'button', title: 'Древо на одном листе — для печати', onclick: () => api.onPoster() }, 'Плакат'),
  );
  const hint = h('p', { class: 'tree-hint' }, 'Тяните холст · колесо — масштаб · нажмите на человека, чтобы дописать ветвь');
  root.append(viewport, tools, hint);

  const t = { x: 0, y: 0, k: 1 };
  let layout = null;
  let selected = null;
  let shownKey;
  let moved = false;

  // ── Отрисовка ────────────────────────────────────────────
  function render() {
    const rootId = store.effectiveRoot();
    tools.hidden = hint.hidden = !rootId;
    if (!rootId) {
      layout = null;
      shownKey = undefined;
      stage.replaceChildren();
      viewport.replaceChildren(stage, h('div', { class: 'tree-empty' },
        h('h2', {}, 'Древо пока пустое'),
        h('p', {}, 'Начните с одного человека — остальных родные допишут сами.'),
        h('button', { class: 'btn btn--primary', type: 'button', onclick: api.onStart }, 'Добавить первого человека'),
      ));
      return;
    }
    viewport.replaceChildren(stage);
    layout = layoutTree(store, rootId, store.flip);

    const links = s('svg', { class: 'tree-links', width: layout.width, height: layout.height },
      layout.links.map((l) => s('path', { class: `link link--${l.type}`, d: l.d })),
      branchLeaves(layout),
      layout.rings.map((r) => s('g', { class: 'wed', transform: `translate(${r.x} ${r.y})` },
        s('ellipse', { rx: 14, ry: 10 }),
        s('circle', { cx: -4.5, r: 6 }),
        s('circle', { cx: 4.5, r: 6 }),
      )),
    );

    const labels = layout.rows.map((y, g) => h('span', { class: 'gen-label', style: `left:${-PAD.left + 26}px;top:${y + CARD_H / 2}px` },
      h('b', {}, roman(g + 1)), 'поколение'));

    const banner = ribbon(store.family.surname, familyFacts(store).since, new Date().getFullYear());
    banner.style.cssText = `left:${layout.width / 2}px;top:${-PAD.top + 44}px`;

    stage.replaceChildren(foliage(layout), links, ...labels, banner, ...layout.nodes.map(renderNode));

    const key = `${rootId}|${store.flip}`;
    if (key !== shownKey && fit(false)) shownKey = key;
  }

  function renderNode(n) {
    const p = store.byId(n.id);
    const isElder = p.id === store.family.elderId;
    const kin = store.meId ? kinship(store, store.meId, p.id) : null;
    const cls = ['node', p.died && 'is-late', isElder && 'is-elder', p.id === store.meId && 'is-me', p.id === selected && 'is-selected'].filter(Boolean).join(' ');
    const addBtn = (type) => h('button', {
      class: `node__add node__add--${type}`, type: 'button', 'data-label': ADD_LABELS[type], 'aria-label': ADD_LABELS[type],
      onclick: () => api.onAdd(type, p.id),
    }, '+');

    return h('div', { class: cls, 'data-id': p.id, style: `left:${n.x}px;top:${n.y}px` },
      h('button', { class: 'card', type: 'button', 'aria-label': fullName(p), onclick: () => { if (!moved) api.onSelect(p.id); } },
        portrait(p),
        h('span', { class: 'card__first' }, p.first || 'Без имени'),
        h('span', { class: 'card__last' }, p.last),
        kin && h('span', { class: 'card__kin' }, kin),
        h('span', { class: 'card__years' }, lifespan(p)),
      ),
      isElder && elderBadge(),
      n.hiddenParents && h('button', {
        class: 'node__up', type: 'button', title: 'Показать родителей и их ветвь', 'aria-label': 'Показать родителей и их ветвь',
        onclick: () => api.onReroot(p.id),
      }, '↑'),
      p.parents.length < 2 && addBtn('parent'),
      addBtn('partner'),
      addBtn('child'),
    );
  }

  function elderBadge() {
    const fest = celebrationInfo(store);
    return fest && h('span', { class: 'node__badge' }, `${fest.age} · ${fest.dateText}`);
  }

  // ── Камера ───────────────────────────────────────────────
  function bounds() {
    const extra = Math.max(0, (RIBBON_W - layout.width) / 2);
    return {
      x0: -PAD.left - extra,
      y0: -PAD.top,
      w: layout.width + PAD.left + PAD.right + extra * 2,
      h: layout.height + PAD.top + PAD.bottom,
    };
  }

  function apply() {
    stage.style.transform = `translate(${t.x}px,${t.y}px) scale(${t.k})`;
    zoomLabel.textContent = `${Math.round(t.k * 100)}%`;
  }

  function animate() {
    stage.classList.add('is-animating');
    stage.addEventListener('transitionend', () => stage.classList.remove('is-animating'), { once: true });
  }

  function zoomAt(px, py, factor) {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * factor));
    const f = k / t.k;
    t.x = px - (px - t.x) * f;
    t.y = py - (py - t.y) * f;
    t.k = k;
    apply();
  }

  function zoomBy(factor) {
    animate();
    zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor);
  }

  // whole = true — вписать древо целиком; иначе по ширине, не мельче читаемого масштаба.
  // Возвращает false, если раздел сейчас скрыт и размеров ещё нет.
  function fit(animated, whole = false) {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (!layout || !vw || !vh) return false;
    const b = bounds();
    const byWidth = (vw - 48) / b.w;
    const byHeight = (vh - 96) / b.h;
    t.k = Math.min(1, whole ? Math.max(MIN_ZOOM, Math.min(byWidth, byHeight)) : Math.max(READABLE_ZOOM, byWidth));
    t.x = (vw - b.w * t.k) / 2 - b.x0 * t.k;
    // Если древо выше экрана — показываем ту сторону, где корни.
    const free = vh - 64 - b.h * t.k;
    t.y = (free >= 0 ? free / 2 : layout.flipped ? free : 12) - b.y0 * t.k;
    if (animated) animate();
    apply();
    return true;
  }

  function focus(id) {
    const n = layout?.nodes.find((x) => x.id === id);
    if (!n) return false;
    t.k = Math.max(t.k, 0.75);
    t.x = viewport.clientWidth / 2 - (n.x + CARD_W / 2) * t.k;
    t.y = viewport.clientHeight / 2 - (n.y + CARD_H / 2) * t.k;
    animate();
    apply();
    return true;
  }

  // ── Жесты: перетаскивание, колесо, щипок ─────────────────
  const pointers = new Map();
  let start = null;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  viewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      moved = false;
      start = { x: e.clientX, y: e.clientY };
    }
    hint.classList.add('is-seen'); // подсказка нужна только до первого касания
    stage.classList.remove('is-animating');
  });

  viewport.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 2) {
      const before = spread();
      p.x = e.clientX;
      p.y = e.clientY;
      const after = spread();
      const rect = viewport.getBoundingClientRect();
      moved = true;
      t.x += after.x - before.x;
      t.y += after.y - before.y;
      zoomAt(after.x - rect.left, after.y - rect.top, after.dist / (before.dist || 1));
      return;
    }
    if (!moved) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
      moved = true;
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add('is-dragging');
    }
    t.x += e.clientX - p.x;
    t.y += e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    apply();
  });

  const release = (e) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) viewport.classList.remove('is-dragging');
  };
  viewport.addEventListener('pointerup', release);
  viewport.addEventListener('pointercancel', release);

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  return {
    render,
    fit,
    focus,
    setSelected(id) {
      selected = id;
      stage.querySelectorAll('.node').forEach((el) => el.classList.toggle('is-selected', el.dataset.id === id));
    },
    // Неинтерактивная копия древа и её габариты — для плаката.
    snapshot() {
      if (!layout) return null;
      const copy = stage.cloneNode(true);
      copy.classList.remove('is-animating');
      // На плакате нет ничего личного: ни «это я», ни подписей родства.
      copy.querySelectorAll('.node__add, .node__up, .card__kin').forEach((el) => el.remove());
      copy.querySelectorAll('.node').forEach((el) => el.classList.remove('is-selected', 'is-me'));
      return { el: copy, bounds: bounds() };
    },
  };
}
