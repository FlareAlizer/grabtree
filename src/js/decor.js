// Украшения: годовые кольца, листва на ветвях, лента-заголовок, листопад.
import { h, s } from './util.js';
import { CARD_H } from './layout.js';

const LEAF = 'M0 0C7-9 19-9 26 0 19 9 7 9 0 0Z'; // лист длиной 26, растёт вправо от черенка

const leaf = (x, y, angle, scale, cls) => s('path', {
  class: cls, d: LEAF,
  transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(1)}) scale(${scale})`,
});

// Годовые кольца: count — сколько лет, filled — сколько из них уже «зажжено» воспоминаниями.
export function drawRings(svg, count, filled = 0) {
  const step = 493 / count;
  const rings = [];
  for (let i = 1; i <= count; i++) {
    const r = 8 + i * step;
    const lit = i <= filled;
    const decade = i % 10 === 0;
    rings.push(s('ellipse', {
      class: `ring${lit ? ' ring--lit' : decade ? ' ring--decade' : ''}`,
      cx: (6 * Math.sin(i * 0.21)).toFixed(1),
      cy: (5 * Math.cos(i * 0.17)).toFixed(1),
      rx: (r * (1 + 0.018 * Math.sin(i * 1.7))).toFixed(1),
      ry: (r * (1 + 0.018 * Math.cos(i * 2.3))).toFixed(1),
      transform: `rotate(${(i * 7) % 180})`,
      'stroke-width': lit ? 2.2 : decade ? 1.6 : (0.6 + 0.5 * Math.abs(Math.sin(i * 0.9))).toFixed(2),
      opacity: lit ? 0.95 : decade ? 0.7 : (0.16 + 0.26 * Math.abs(Math.sin(i * 1.3))).toFixed(2),
    }));
  }
  svg.replaceChildren(...rings, s('circle', { class: 'ring-core', r: 4 }));
}

// Листья на соединительных линиях — чтобы связи читались как ветви.
export function branchLeaves(layout) {
  const grow = layout.flipped ? -1 : 1;
  const out = [];
  layout.links.forEach((link, i) => {
    if (link.type !== 'child') return;
    const cls = i % 3 === 0 ? 'leaf leaf--gold' : 'leaf';
    const size = 0.8 + (i % 3) * 0.12;
    const span = link.tx - link.ox;
    if (Math.abs(span) < 1) {
      out.push(leaf(link.ox, link.busY, grow * 40, size, cls), leaf(link.ox, link.busY, grow * 140, size, cls));
      return;
    }
    const dir = Math.sign(span);
    const away = dir > 0 ? 0 : 180; // куда уходит ветвь по горизонтали
    out.push(leaf(link.ox + span * 0.5, link.busY, away - dir * grow * 40, size, cls));
    if (Math.abs(span) > 90) out.push(leaf(link.tx - dir * 18, link.busY, away + dir * grow * 22, size, 'leaf'));
  });
  return out;
}

function pointOnQuad(p0, p1, p2, t) {
  const u = 1 - t;
  const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
  const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
  const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
  const dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
  return [x, y, (Math.atan2(dy, dx) * 180) / Math.PI];
}

// Бледное дерево за карточками: ствол от корня и по паре ветвей на каждое поколение.
export function foliage(layout) {
  const { rootX, rows, extents } = layout;
  const svg = (parts) => s('svg', { class: 'foliage', width: layout.width, height: layout.height, 'aria-hidden': 'true' }, parts);
  if (rows.length < 2) return svg([]); // одному поколению дерево за спиной ни к чему
  const grow = layout.flipped ? -1 : 1;
  const mid = (i) => rows[i] + CARD_H / 2;
  const base = mid(0);
  const tip = mid(rows.length - 1) + grow * (CARD_H / 2 + 80);
  const half = (base + tip) / 2;

  const parts = [s('path', {
    class: 'foliage__trunk',
    d: `M${rootX - 20} ${base}Q${rootX - 6} ${half} ${rootX - 2} ${tip}L${rootX + 2} ${tip}Q${rootX + 6} ${half} ${rootX + 20} ${base}Z`,
  })];

  for (let i = 1; i < rows.length; i++) {
    const y = (mid(i - 1) + mid(i)) / 2;
    for (const side of [-1, 1]) {
      const edge = side < 0 ? rootX - extents[i].min : extents[i].max - rootX;
      const reach = Math.max(280, edge + 120);
      const p0 = [rootX, y - grow * 36];
      const p1 = [rootX + side * reach * 0.72, y - grow * 16];
      const p2 = [rootX + side * reach, y + grow * 150];
      parts.push(s('path', { class: 'foliage__branch', d: `M${p0}Q${p1} ${p2}` }));
      [0.38, 0.56, 0.74, 0.9, 1].forEach((t, k) => {
        const [x, py, angle] = pointOnQuad(p0, p1, p2, t);
        const tilt = t === 1 ? 0 : (k % 2 ? 50 : -50);
        parts.push(leaf(x, py, angle + tilt, 3.2 + ((i + k) % 3) * 0.7, 'foliage__leaf'));
      });
    }
  }
  const up = grow > 0 ? 90 : -90;
  parts.push(leaf(rootX, tip, up, 3.6, 'foliage__leaf'), leaf(rootX, tip, up - 42, 3, 'foliage__leaf'), leaf(rootX, tip, up + 42, 3, 'foliage__leaf'));

  return svg(parts);
}

// Лента с названием древа и годами на концах — как на старых родословных плакатах.
export function ribbon(surname, from, to) {
  return h('div', { class: 'ribbon' },
    h('i', { class: 'ribbon__tail' }),
    h('i', { class: 'ribbon__tail ribbon__tail--r' }),
    h('div', { class: 'ribbon__body' },
      from && h('span', { class: 'ribbon__year' }, from),
      h('span', { class: 'ribbon__title' }, ...(surname ? ['Древо семьи ', h('em', {}, surname)] : ['Семейное ', h('em', {}, 'древо')])),
      to && h('span', { class: 'ribbon__year' }, to),
    ),
  );
}

// Листопад — маленький праздник, когда в древе появляется новый человек или воспоминание.
export function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = h('div', { class: 'leaf-fall', 'aria-hidden': 'true' });
  for (let i = 0; i < 18; i++) {
    box.append(s('svg', {
      class: `leaf-fall__leaf${i % 3 ? '' : ' leaf-fall__leaf--gold'}`,
      viewBox: '-2 -10 30 20',
      style: `left:${(i * 53 + 7) % 100}%;animation-delay:${(i % 6) * 0.12}s;animation-duration:${2.4 + (i % 5) * 0.35}s;--spin:${(i % 2 ? 1 : -1) * (200 + i * 20)}deg;--drift:${((i * 37) % 120) - 60}px`,
    }, s('path', { d: LEAF })));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4600);
}
