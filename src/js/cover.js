import { h, plural, years } from './util.js';
import { store } from './store.js';
import { celebrationInfo, familyFacts } from './family.js';
import { drawRings } from './decor.js';

const $ = (id) => document.getElementById(id);

// Обложка: первый экран и вход. Новому человеку нужны имя и кодовое слово семьи;
// по ссылке-приглашению слово приходит само (inviteCode), остаётся представиться.
export function initCover(inviteCode = '') {
  const cover = $('cover');
  const nameInput = $('enter-name');
  const codeInput = $('enter-code');
  const error = $('enter-error');
  const submit = cover.querySelector('button[type="submit"]');

  function fill() {
    const { surname } = store.family;
    $('cover-title').replaceChildren(...(surname ? ['Древо семьи ', h('em', {}, surname)] : ['Семейное ', h('em', {}, 'древо')]));
    nameInput.value = store.me;
    error.textContent = '';

    const needCode = !store.authorized && !inviteCode;
    $('enter-code-row').hidden = !needCode;
    $('enter-hint').textContent = store.authorized
      ? 'Имя видят родные рядом с тем, что вы дописали.'
      : inviteCode ? 'Вас пригласили в семейное древо — осталось представиться.'
        : 'Кодовое слово знают родные: попросите у них ссылку-приглашение.';
    $('logout-btn').hidden = !store.authorized;

    const facts = familyFacts(store);
    $('cover-eyebrow').textContent = facts.since ? `Семейный архив · с ${facts.since} года` : 'Семейный архив';
    $('cover-stats').hidden = !facts.list.length;
    $('cover-stats').replaceChildren(...facts.list.map(({ n, label }) => h('div', {}, h('dd', {}, n), h('dt', {}, label))));

    const fest = celebrationInfo(store);
    $('dedication').hidden = !fest;
    $('rings-caption').hidden = !fest;
    if (!fest) return drawRings($('rings'), 60);

    const { elder, age, daysLeft, filled } = fest;
    const countdown = daysLeft > 0
      ? `${plural(daysLeft, ['Остался', 'Осталось', 'Осталось'])} ${daysLeft} ${plural(daysLeft, ['день', 'дня', 'дней'])}, чтобы дописать недостающие ветви.`
      : daysLeft === 0 ? 'Это сегодня — с днём рождения!' : 'Древо продолжает расти.';
    $('dedication-age').textContent = age;
    $('dedication-text').replaceChildren(h('b', {}, `${fest.dateText} — день рождения: ${elder.first}, ${years(age)}.`), ' ', countdown);
    $('rings-caption').replaceChildren(
      `${age} ${plural(age, ['годовое кольцо', 'годовых кольца', 'годовых колец'])} — по одному на каждый год.`,
      h('br'),
      filled ? `${filled} уже ${plural(filled, ['светится', 'светятся', 'светятся'])}: столько воспоминаний собрала семья.` : 'Каждое воспоминание зажигает одно кольцо.',
    );
    drawRings($('rings'), age, filled);
  }

  function toggle(show) {
    cover.classList.toggle('is-leaving', !show);
    $('app').inert = show; // пока обложка открыта, до сайта под ней не дотянуться и с клавиатуры
  }

  $('enter-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      error.textContent = 'Представьтесь, пожалуйста.';
      return nameInput.focus();
    }
    error.textContent = '';
    submit.disabled = true;
    try {
      if (store.authorized) await store.setMe(name);
      else await store.login(name, inviteCode || codeInput.value);
      codeInput.value = '';
      toggle(false);
    } catch (err) {
      error.textContent = err.message;
      // приглашение устарело (слово сменили) — даём ввести новое вручную
      if (err.status === 401 && inviteCode) {
        inviteCode = '';
        fill();
        nameInput.value = name;
        error.textContent = err.message;
      }
    } finally {
      submit.disabled = false;
    }
  });
  $('logout-btn').addEventListener('click', () => store.logout());

  return {
    show(focusName = false) {
      fill();
      toggle(true);
      if (focusName) nameInput.focus();
    },
    hide: () => toggle(false),
  };
}
