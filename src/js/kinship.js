// «Кем он мне приходится?» — название родства между двумя людьми древа.
// Ключ — «сколько поколений вверх от меня, сколько вниз к нему» до общего предка.
// В каждой строке: [он, она, кого (он), кого (она)].
const TERMS = {
  '1,0': ['отец', 'мать', 'отца', 'матери'],
  '2,0': ['дедушка', 'бабушка', 'дедушки', 'бабушки'],
  '0,1': ['сын', 'дочь', 'сына', 'дочери'],
  '0,2': ['внук', 'внучка', 'внука', 'внучки'],
  '1,1': ['брат', 'сестра', 'брата', 'сестры'],
  '2,1': ['дядя', 'тётя', 'дяди', 'тёти'],
  '1,2': ['племянник', 'племянница', 'племянника', 'племянницы'],
  '2,2': ['двоюродный брат', 'двоюродная сестра', 'двоюродного брата', 'двоюродной сестры'],
  '3,1': ['двоюродный дедушка', 'двоюродная бабушка', 'двоюродного дедушки', 'двоюродной бабушки'],
  '1,3': ['внучатый племянник', 'внучатая племянница', 'внучатого племянника', 'внучатой племянницы'],
  '3,2': ['двоюродный дядя', 'двоюродная тётя', 'двоюродного дяди', 'двоюродной тёти'],
  '2,3': ['двоюродный племянник', 'двоюродная племянница', 'двоюродного племянника', 'двоюродной племянницы'],
  '3,3': ['троюродный брат', 'троюродная сестра', 'троюродного брата', 'троюродной сестры'],
};
const DISTANT = ['дальний родственник', 'дальняя родственница', 'дальнего родственника', 'дальней родственницы'];

function term(up, down) {
  const known = TERMS[`${up},${down}`];
  if (known) return known;
  if (down === 0 && up > 2) {
    const pra = 'пра'.repeat(up - 2);
    return [`${pra}дедушка`, `${pra}бабушка`, `${pra}дедушки`, `${pra}бабушки`];
  }
  if (up === 0 && down > 2) {
    const pra = 'пра'.repeat(down - 2);
    return [`${pra}внук`, `${pra}внучка`, `${pra}внука`, `${pra}внучки`];
  }
  return DISTANT;
}

const pick = (forms, person, genitive = false) => forms[(genitive ? 2 : 0) + (person.gender === 'f' ? 1 : 0)];

// Все предки человека с расстоянием в поколениях (сам человек — 0).
function ancestors(store, id) {
  const dist = new Map([[id, 0]]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    for (const parent of store.parentsOf(cur)) {
      if (dist.has(parent.id)) continue;
      dist.set(parent.id, dist.get(cur) + 1);
      queue.push(parent.id);
    }
  }
  return dist;
}

function blood(store, a, b) {
  const up = ancestors(store, a);
  const down = ancestors(store, b);
  let best = null;
  for (const [id, u] of up) {
    const d = down.get(id);
    if (d != null && (!best || u + d < best.up + best.down)) best = { up: u, down: d };
  }
  return best;
}

export function kinship(store, meId, id) {
  const me = store.byId(meId);
  const other = store.byId(id);
  if (!me || !other) return null;
  if (me.id === other.id) return 'это вы';
  const she = other.gender === 'f';
  if (me.partners.includes(other.id)) return she ? 'жена' : 'муж';

  const direct = blood(store, me.id, other.id);
  if (direct) return pick(term(direct.up, direct.down), other);

  // супруг или супруга кровного родственника: «жена дяди», «зять»
  for (const spouse of store.partnersOf(other.id)) {
    const rel = blood(store, me.id, spouse.id);
    if (!rel) continue;
    if (rel.up === 0 && rel.down === 1) return she ? 'невестка' : 'зять';
    if (rel.up === 1 && rel.down === 0) return she ? 'мачеха' : 'отчим';
    return `${she ? 'жена' : 'муж'} ${pick(term(rel.up, rel.down), spouse, true)}`;
  }

  // кровный родственник мужа или жены: «тёща», «брат мужа»
  for (const spouse of store.partnersOf(me.id)) {
    const rel = blood(store, spouse.id, other.id);
    if (!rel) continue;
    const wife = spouse.gender === 'f';
    if (rel.up === 1 && rel.down === 0) return wife ? (she ? 'тёща' : 'тесть') : (she ? 'свекровь' : 'свёкор');
    return `${pick(term(rel.up, rel.down), other)} ${wife ? 'жены' : 'мужа'}`;
  }
  return null;
}
