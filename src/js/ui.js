import { h } from './util.js';

export function toast(text) {
  const el = h('div', { class: 'toast' }, text);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 4200);
}

// Выполняет действие с сервером; если не вышло — показывает причину и возвращает undefined.
export async function attempt(action) {
  try {
    return await action();
  } catch (err) {
    toast(err.message || 'Не получилось. Попробуйте ещё раз.');
    return undefined;
  }
}
