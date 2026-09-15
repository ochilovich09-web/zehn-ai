/* Ilova holati (oddiy kuzatiladigan store) */

const state = {
  user: null,
  chats: [],
  activeChatId: null,
  messages: [],
  attachments: [],      // yuborilishi kutilayotgan fayllar
  archivedView: false,
  search: '',
  streaming: false,
  config: null,
  sidebarOpen: false,
};

const subscribers = new Map();   // key -> Set<fn>

export const getState = () => state;

export function set(patch) {
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (state[k] === v) continue;
    state[k] = v;
    changed.push(k);
  }
  for (const key of changed) {
    for (const fn of subscribers.get(key) || []) fn(state[key], state);
  }
  for (const fn of subscribers.get('*') || []) fn(state);
  return state;
}

export function subscribe(key, fn) {
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key).add(fn);
  return () => subscribers.get(key).delete(fn);
}

/* ── Mavzu (theme) ── */
const THEME_KEY = 'zehn.theme';

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
}

export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}

/** Yorug' <-> qorong'i almashtirish (system bo'lsa qarama-qarshisiga o'tadi) */
export function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const isDarkNow = current === 'dark'
    || (current === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = isDarkNow ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
