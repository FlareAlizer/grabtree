// Раскладка древа потомков: «семья» = человек + супруги в ряд, дети — рядом в следующем поколении.
// Чистая функция: на входе store и корень, на выходе координаты карточек и пути связей.
// flipped = true — корни внизу, младшие наверху, как у настоящего дерева.

export const CARD_W = 172;
export const CARD_H = 240;
const PARTNER_GAP = 40;
const SIBLING_GAP = 44;
export const GEN_GAP = 108;
const LINK_Y = 73; // высота линии брака — по центру портрета
const BRACKET = 16; // на сколько скоба дальнего брака выступает над карточками
const ELBOW = 14;

const membersWidth = (n) => n * CARD_W + (n - 1) * PARTNER_GAP;

export function layoutTree(store, rootId, flipped = false) {
  const seen = new Set();
  let maxDepth = 0;

  function build(id, depth) {
    maxDepth = Math.max(maxDepth, depth);
    seen.add(id);
    const partners = store.partnersOf(id).filter((p) => !seen.has(p.id));
    partners.forEach((p) => seen.add(p.id));
    // Человек стоит между супругами: первый — справа, второй — слева, дальше по очереди.
    // Так линия каждого брака идёт от него самого, а не от одного супруга к другому.
    const left = [];
    const right = [];
    partners.forEach((p, i) => (i % 2 ? left.unshift(p.id) : right.push(p.id)));
    const members = [...left, id, ...right];

    const kids = [];
    for (const memberId of members) {
      for (const child of store.childrenOf(memberId)) {
        if (!seen.has(child.id) && !kids.includes(child.id)) kids.push(child.id);
      }
    }
    const children = [];
    for (const kid of kids) {
      if (!seen.has(kid)) children.push(build(kid, depth + 1));
    }

    const ownW = membersWidth(members.length);
    const kidsW = children.reduce((sum, c) => sum + c.width, 0) + Math.max(0, children.length - 1) * SIBLING_GAP;
    return { root: id, members, children, ownW, kidsW, width: Math.max(ownW, kidsW) };
  }

  const root = build(rootId, 0);
  const rowY = (depth) => (flipped ? maxDepth - depth : depth) * (CARD_H + GEN_GAP);

  const nodes = [];
  const links = [];
  const rings = [];
  const extents = [];

  function place(unit, x, depth) {
    const y = rowY(depth);
    const startX = x + (unit.width - unit.ownW) / 2;
    const leftOf = (i) => startX + i * (CARD_W + PARTNER_GAP);
    const index = new Map(unit.members.map((id, i) => [id, i]));
    const center = (id) => leftOf(index.get(id)) + CARD_W / 2;
    const rootIndex = index.get(unit.root);

    unit.members.forEach((id, i) => {
      const nx = leftOf(i);
      nodes.push({ id, x: nx, y, depth });
      const row = (extents[depth] ||= { min: nx, max: nx + CARD_W });
      row.min = Math.min(row.min, nx);
      row.max = Math.max(row.max, nx + CARD_W);
      if (id === unit.root) return;

      const side = Math.sign(i - rootIndex);
      const between = Math.abs(i - rootIndex) - 1; // сколько карточек стоит между человеком и этим супругом
      if (between === 0) {
        const gap = leftOf(Math.min(i, rootIndex)) + CARD_W;
        links.push({ type: 'partner', d: `M${gap} ${y + LINK_Y}h${PARTNER_GAP}` });
        rings.push({ x: gap + PARTNER_GAP / 2, y: y + LINK_Y });
      } else {
        // Третий и следующие браки: скоба над карточками, с той стороны, где нет детей.
        const edge = flipped ? y + CARD_H : y;
        const lift = edge + (flipped ? 1 : -1) * BRACKET * between;
        const from = center(unit.root) + side * CARD_W * 0.3;
        const to = nx + CARD_W / 2;
        links.push({ type: 'partner', d: `M${from} ${edge}V${lift}H${to}V${edge}` });
        rings.push({ x: (from + to) / 2, y: lift });
      }
    });

    // Края карточек, обращённые друг к другу, и «шина» посередине между поколениями.
    const childY = rowY(depth + 1);
    const parentEdge = flipped ? y : y + CARD_H;
    const childEdge = flipped ? childY + CARD_H : childY;
    const busY = (parentEdge + childEdge) / 2;

    let cx = x + (unit.width - unit.kidsW) / 2;
    for (const child of unit.children) {
      const tx = place(child, cx, depth + 1);
      cx += child.width + SIBLING_GAP;

      // Линия идёт от середины пары, если родители стоят рядом. Иначе — от одного родителя:
      // от того, кто не в центре ряда, чтобы было видно, чей это ребёнок.
      const parents = store.byId(child.root).parents.filter((p) => index.has(p));
      const paired = parents.length === 2 && Math.abs(index.get(parents[0]) - index.get(parents[1])) === 1;
      const single = parents.find((p) => p !== unit.root) ?? parents[0] ?? unit.root;
      const ox = paired ? (center(parents[0]) + center(parents[1])) / 2 : center(single);
      const oy = paired ? y + LINK_Y : parentEdge;
      links.push({ type: 'child', d: elbow(ox, oy, tx, childEdge, busY), ox, tx, busY });
    }
    return center(unit.root);
  }

  place(root, 0, 0);

  const placed = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    n.hiddenParents = store.byId(n.id).parents.some((p) => store.byId(p) && !placed.has(p));
  }

  const rows = [];
  for (let depth = 0; depth <= maxDepth; depth++) rows.push(rowY(depth));

  return {
    nodes,
    links,
    rings,
    rows,
    extents,
    flipped,
    rootX: root.width / 2,
    width: root.width,
    height: (maxDepth + 1) * CARD_H + maxDepth * GEN_GAP,
    generations: maxDepth + 1,
  };
}

function elbow(ox, oy, tx, ty, busY) {
  if (Math.abs(tx - ox) < 1) return `M${ox} ${oy}V${ty}`;
  const dir = Math.sign(tx - ox);
  const grow = Math.sign(ty - oy);
  const r = Math.min(ELBOW, Math.abs(tx - ox) / 2);
  return `M${ox} ${oy}V${busY - grow * r}Q${ox} ${busY} ${ox + dir * r} ${busY}H${tx - dir * r}Q${tx} ${busY} ${tx} ${busY + grow * r}V${ty}`;
}
