import { h } from './util.js';

// Плакат: древо на одном листе A3 (альбомный), в раме — чтобы распечатать и повесить на стену.
// Лист всегда рисуется в «типографских» пикселях, а на экране уменьшается целиком.
const SHEET = { w: 1584, h: 1120 };
const AREA = { x: 84, y: 70, w: 1416, h: 926 };

export function openPoster(snapshot, footer) {
  if (!snapshot) return;
  const { el: tree, bounds } = snapshot;
  const k = Math.min(AREA.w / bounds.w, AREA.h / bounds.h, 1.5);
  const tx = AREA.x + (AREA.w - bounds.w * k) / 2 - bounds.x0 * k;
  const ty = AREA.y + (AREA.h - bounds.h * k) / 2 - bounds.y0 * k;
  tree.style.transform = `translate(${tx}px,${ty}px) scale(${k})`;
  tree.inert = true;

  const sheet = h('div', { class: 'poster__sheet' },
    tree,
    h('i', { class: 'poster__frame' }),
    ['tl', 'tr', 'bl', 'br'].map((pos) => h('i', { class: `poster__corner poster__corner--${pos}` })),
    h('p', { class: 'poster__foot' }, footer.map((line) => h('span', {}, line))),
  );
  const fitBox = h('div', { class: 'poster__fit' }, sheet);

  function close() {
    overlay.remove();
    document.body.classList.remove('has-poster');
    removeEventListener('resize', resize);
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.stopImmediatePropagation();
    close();
  }
  function resize() {
    const scale = Math.min((innerWidth - 48) / SHEET.w, (innerHeight - 124) / SHEET.h, 1);
    fitBox.style.width = `${SHEET.w * scale}px`;
    fitBox.style.height = `${SHEET.h * scale}px`;
    sheet.style.transform = `scale(${scale})`;
  }

  const overlay = h('div', { class: 'poster', role: 'dialog', 'aria-label': 'Плакат с древом' },
    h('div', { class: 'poster__bar' },
      h('span', { class: 'poster__hint' }, 'Лист A3, альбомный. В окне печати выберите «Сохранить как PDF» — файл примут в любой типографии.'),
      h('button', { class: 'btn btn--primary', type: 'button', onclick: () => window.print() }, 'Печать или PDF'),
      h('button', { class: 'btn', type: 'button', onclick: close }, 'Закрыть'),
    ),
    fitBox,
  );

  document.body.classList.add('has-poster');
  document.body.append(overlay);
  addEventListener('resize', resize);
  document.addEventListener('keydown', onKey, true);
  resize();
}
