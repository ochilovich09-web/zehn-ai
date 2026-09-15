/* Admin panel: foydalanuvchilar, foydalanish, bloklash va tarifni o'zgartirish */
import { $, el, renderIcons, debounce, formatDate, formatRelative } from '../core/dom.js';
import { api } from '../core/api.js';
import { t, getLanguage, onLanguageChange } from '../core/i18n.js';
import { getState } from '../core/store.js';
import { toast, confirmDialog } from './toast.js';

const PAGE = 50;
const ONLINE_MS = 5 * 60 * 1000;
const REFRESH_MS = 30 * 1000;
const TIERS = ['free', 'pro', 'premium'];
const LOCALE = { uz: 'uz-UZ', ru: 'ru-RU', en: 'en-US' };

const state = {
  q: '', status: '', tier: '', sort: 'last_seen',
  users: [], total: 0, stats: null, limits: {},
  selectedId: null, detail: null, busy: false, timer: null,
};

let onExit = () => {};

/* ── Kirish / chiqish ── */
export function initAdmin({ onClose }) {
  onExit = onClose;
  onLanguageChange(() => { if (isOpen()) renderAll(); });
  document.addEventListener('keydown', (e) => {
    // Modal ochiq bo'lsa Escape avval modalni yopadi
    if (e.key === 'Escape' && isOpen() && state.selectedId && $('#modal').hidden) closeDrawer();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isOpen()) refresh({ silent: true });
  });
}

export const isOpen = () => !$('#admin-view').hidden;

export async function openAdmin() {
  if (getState().user?.role !== 'admin') return;
  $('#app-main').hidden = true;
  $('#admin-view').hidden = false;
  $('#btn-admin')?.classList.add('is-active');
  if (location.hash !== '#/admin') history.replaceState(null, '', '#/admin');

  buildShell();
  await refresh();

  clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (isOpen() && !document.hidden && !state.busy) refresh({ silent: true });
  }, REFRESH_MS);
}

export function closeAdmin() {
  if (!isOpen()) return;
  clearInterval(state.timer);
  state.selectedId = null;
  state.detail = null;
  $('#admin-view').hidden = true;
  $('#app-main').hidden = false;
  $('#btn-admin')?.classList.remove('is-active');
  if (location.hash === '#/admin') history.replaceState(null, '', location.pathname);
}

/* ── Ma'lumot yuklash ── */
async function refresh({ silent = false, append = false } = {}) {
  const params = new URLSearchParams({ sort: state.sort, limit: String(PAGE), offset: String(append ? state.users.length : 0) });
  if (state.q) params.set('q', state.q);
  if (state.status) params.set('status', state.status);
  if (state.tier) params.set('tier', state.tier);

  try {
    const [list, stats] = await Promise.all([api.adminUsers(params), append ? null : api.adminStats()]);
    state.users = append ? [...state.users, ...list.users] : list.users;
    state.total = list.total;
    if (stats) { state.stats = stats.stats; state.limits = stats.tiers; }
    renderStats();
    renderToolbarCounts();
    renderTable();
    if (state.selectedId && !silent) await loadDetail(state.selectedId);
  } catch (err) {
    if (!silent) toast(err.message || t('error.generic'), 'error');
  }
}

async function loadDetail(id) {
  try {
    state.detail = await api.adminUser(id);
    renderDrawer();
  } catch (err) {
    toast(err.message || t('error.generic'), 'error');
    closeDrawer();
  }
}

/* ── Karkas ── */
function buildShell() {
  const view = $('#admin-view');
  view.replaceChildren(
    el('header', { class: 'admin__head' }, [
      el('div', { class: 'admin__title-row' }, [
        el('button', { class: 'icon-btn only-mobile', type: 'button', onClick: () => $('#app-view').classList.add('is-menu-open') },
          [el('i', { 'data-icon': 'menu' })]),
        el('h1', { class: 'admin__title', text: t('admin.title') }),
        el('button', {
          class: 'icon-btn', type: 'button', title: t('admin.refresh'),
          onClick: () => refresh(),
        }, [el('i', { 'data-icon': 'refresh' })]),
      ]),
      el('div', { class: 'admin-stats', id: 'admin-stats' }),
      toolbar(),
    ]),
    el('div', { class: 'admin__body', id: 'admin-body' }),
    el('div', { id: 'admin-drawer' }),
  );
  renderIcons(view);
}

function toolbar() {
  const search = el('input', {
    type: 'search',
    value: state.q,
    placeholder: t('admin.search'),
    'aria-label': t('admin.search'),
  });
  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); refresh(); }, 300));

  const statusSeg = el('div', { class: 'segmented', role: 'group', id: 'admin-status' });
  for (const [value, key] of [['', 'admin.all'], ['active', 'admin.active'], ['blocked', 'admin.blocked']]) {
    statusSeg.append(el('button', {
      type: 'button',
      class: state.status === value ? 'is-active' : '',
      dataset: { value },
      onClick: () => { state.status = value; syncSegment(statusSeg, value); refresh(); },
    }, [el('span', { text: t(key) }), el('small', { dataset: { count: value } })]));
  }

  const tierSelect = el('select', { class: 'admin-select', 'aria-label': t('admin.tier') }, [
    el('option', { value: '', text: t('admin.allTiers') }),
    ...TIERS.map((tier) => el('option', { value: tier, text: tierName(tier) })),
  ]);
  tierSelect.value = state.tier;
  tierSelect.addEventListener('change', () => { state.tier = tierSelect.value; refresh(); });

  const sortSelect = el('select', { class: 'admin-select', 'aria-label': t('admin.sort') }, [
    el('option', { value: 'last_seen', text: t('admin.sortSeen') }),
    el('option', { value: 'requests', text: t('admin.sortRequests') }),
    el('option', { value: 'tokens', text: t('admin.sortTokens') }),
    el('option', { value: 'newest', text: t('admin.sortNewest') }),
  ]);
  sortSelect.value = state.sort;
  sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; refresh(); });

  return el('div', { class: 'admin-toolbar' }, [
    el('div', { class: 'search' }, [el('i', { 'data-icon': 'search' }), search]),
    statusSeg,
    tierSelect,
    sortSelect,
  ]);
}

function syncSegment(group, value) {
  for (const b of group.querySelectorAll('button')) b.classList.toggle('is-active', b.dataset.value === value);
}

function renderAll() {
  buildShell();
  renderStats();
  renderToolbarCounts();
  renderTable();
  renderDrawer();
}

/* ── Statistika qatori (har bir raqam — filtr) ── */
function renderStats() {
  const box = $('#admin-stats');
  const s = state.stats;
  if (!box || !s) return;
  const n = (v) => fmtNumber(v);

  const stat = (value, label, { cls = '', onClick } = {}) => el(onClick ? 'button' : 'span', {
    class: `admin-stat ${cls}`,
    type: onClick ? 'button' : null,
    onClick,
  }, [el('b', { text: n(value) }), el('span', { text: label })]);

  const items = [
    stat(s.users, t('admin.statUsers'), { onClick: () => setStatus('') }),
    stat(s.online, t('admin.statOnline'), { cls: 'admin-stat--online' }),
    stat(s.active24h, t('admin.statActive')),
    stat(s.requests24h, t('admin.statRequests')),
    stat(s.tokens24h, t('admin.statTokens')),
    stat(s.new24h, t('admin.statNew')),
  ];
  if (s.blocked) {
    items.push(stat(s.blocked, t('admin.statBlocked'), { cls: 'admin-stat--danger', onClick: () => setStatus('blocked') }));
  }
  box.replaceChildren(...items);
}

function setStatus(value) {
  state.status = value;
  const group = $('#admin-status');
  if (group) syncSegment(group, value);
  refresh();
}

function renderToolbarCounts() {
  const s = state.stats;
  const group = $('#admin-status');
  if (!s || !group) return;
  const counts = { '': s.users, active: s.users - s.blocked, blocked: s.blocked };
  for (const small of group.querySelectorAll('small')) small.textContent = fmtNumber(counts[small.dataset.count] ?? 0);
}

/* ── Jadval ── */
function renderTable() {
  const body = $('#admin-body');
  if (!body) return;

  if (!state.users.length) {
    body.replaceChildren(el('div', { class: 'admin-empty' }, [
      el('b', { text: t('admin.emptyTitle') }),
      el('span', { text: state.q || state.status || state.tier ? t('admin.emptyFiltered') : t('admin.emptyNone') }),
    ]));
    return;
  }

  const rows = state.users.map((u) => {
    const tr = el('tr', {
      tabindex: '0',
      class: u.id === state.selectedId ? 'is-selected' : '',
      dataset: { id: u.id },
      onClick: () => openDrawer(u.id),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(u.id); } },
    }, [
      el('td', {}, [userCell(u)]),
      el('td', { class: 'col-tier' }, [el('span', { class: `tag tag--${u.tier}`, text: tierName(u.tier) })]),
      el('td', {}, [meter(u.requests24h, u.role === 'admin' ? 0 : state.limits[u.tier])]),
      el('td', { class: 'num col-total' }, [
        el('div', { text: fmtNumber(u.requests) }),
        el('small', { class: 'admin-muted', text: `${fmtCompact(u.tokens)} ${t('admin.tokensShort')}` }),
      ]),
      el('td', { class: 'col-seen admin-muted', text: presence(u) }),
    ]);
    return tr;
  });

  const table = el('table', { class: 'admin-table' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', { text: t('admin.colUser') }),
      el('th', { class: 'col-tier', text: t('admin.tier') }),
      el('th', { text: t('admin.col24h') }),
      el('th', { class: 'num col-total', text: t('admin.colTotal') }),
      el('th', { class: 'col-seen', text: t('admin.colSeen') }),
    ])]),
    el('tbody', {}, rows),
  ]);

  const more = state.users.length < state.total
    ? el('div', { class: 'admin-more' }, [el('button', {
      class: 'btn btn--ghost btn--sm',
      type: 'button',
      text: t('admin.showMore', { n: state.total - state.users.length }),
      onClick: () => refresh({ append: true }),
    })])
    : null;

  body.replaceChildren(table, ...(more ? [more] : []));
  renderIcons(body);
}

function userCell(u) {
  const online = isOnline(u);
  const avatar = el('span', { class: 'avatar', text: initials(u.fullName) });
  if (u.avatar) { avatar.style.backgroundImage = `url("${u.avatar}")`; avatar.textContent = ''; }

  return el('div', { class: 'admin-user' }, [
    el('span', { class: `admin-user__avatar${online ? ' is-online' : ''}`, title: online ? t('admin.online') : '' }, [avatar]),
    el('span', { class: 'admin-user__text' }, [
      el('span', { class: 'admin-user__name' }, [
        el('span', { text: u.fullName }),
        u.status === 'blocked' ? el('span', { class: 'tag tag--blocked', text: t('admin.blockedTag') }) : null,
        u.role === 'admin' ? el('span', { class: 'tag tag--admin', text: 'admin' }) : null,
      ]),
      el('span', { class: 'admin-user__email', text: u.email }),
    ]),
  ]);
}

/** 24 soatlik foydalanish o'lchagichi. limit 0/undefined — cheklovsiz. */
function meter(used, limit) {
  if (!limit) {
    return el('div', { class: 'meter' }, [
      el('span', { class: 'meter__label', text: fmtNumber(used) }),
      el('span', { class: 'meter__unlimited', text: t('admin.unlimited') }),
    ]);
  }
  const ratio = Math.min(used / limit, 1);
  const cls = ratio >= 1 ? ' is-full' : ratio >= 0.8 ? ' is-warn' : '';
  const fill = el('span', { class: 'meter__fill' });
  fill.style.width = `${Math.round(ratio * 100)}%`;
  return el('div', {
    class: `meter${cls}`,
    role: 'meter',
    'aria-valuemin': '0',
    'aria-valuemax': String(limit),
    'aria-valuenow': String(Math.min(used, limit)),
    'aria-label': t('admin.col24h'),
  }, [
    el('span', { class: 'meter__track' }, [fill]),
    el('span', { class: 'meter__label', text: `${fmtNumber(used)} / ${fmtNumber(limit)}` }),
  ]);
}

/* ── Tafsilot paneli ── */
async function openDrawer(id) {
  state.selectedId = id;
  state.detail = null;
  for (const tr of document.querySelectorAll('.admin-table tbody tr')) tr.classList.toggle('is-selected', tr.dataset.id === id);
  renderDrawer();
  await loadDetail(id);
}

function closeDrawer() {
  state.selectedId = null;
  state.detail = null;
  for (const tr of document.querySelectorAll('.admin-table tbody tr.is-selected')) tr.classList.remove('is-selected');
  renderDrawer();
}

function renderDrawer() {
  const host = $('#admin-drawer');
  if (!host) return;
  if (!state.selectedId) { host.replaceChildren(); return; }

  const d = state.detail;
  const listRow = state.users.find((u) => u.id === state.selectedId);
  const u = d?.user || listRow;
  if (!u) { host.replaceChildren(); return; }

  const avatar = el('span', { class: 'avatar', text: initials(u.fullName) });
  if (u.avatar) { avatar.style.backgroundImage = `url("${u.avatar}")`; avatar.textContent = ''; }
  const online = isOnline(u);

  const drawer = el('aside', { class: 'drawer', role: 'dialog', 'aria-label': u.fullName }, [
    el('div', { class: 'drawer__head' }, [
      avatar,
      el('div', { class: 'drawer__who' }, [
        el('h3', {}, [
          el('span', { text: u.fullName }),
          u.status === 'blocked' ? el('span', { class: 'tag tag--blocked', text: t('admin.blockedTag') }) : null,
          u.role === 'admin' ? el('span', { class: 'tag tag--admin', text: 'admin' }) : null,
        ]),
        el('p', { text: u.email }),
        el('div', { class: `drawer__presence${online ? ' is-online' : ''}`, text: presence(u) }),
      ]),
      el('button', { class: 'icon-btn', type: 'button', title: t('close'), onClick: closeDrawer }, [el('i', { 'data-icon': 'x' })]),
    ]),
    el('div', { class: 'drawer__body' }, d ? drawerSections(u, d) : [el('p', { class: 'drawer__hint', text: '…' })]),
  ]);

  host.replaceChildren(el('div', { class: 'drawer-scrim only-mobile', onClick: closeDrawer }), drawer);
  renderIcons(host);
}

function drawerSections(u, d) {
  const isSelf = u.id === getState().user?.id;
  const sections = [];

  // Tarif
  const picker = el('div', { class: 'tier-picker', role: 'radiogroup', 'aria-label': t('admin.tier') });
  for (const tier of TIERS) {
    const limit = state.limits[tier];
    picker.append(el('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(u.tier === tier),
      class: u.tier === tier ? 'is-active' : '',
      dataset: { tier },
      onClick: () => { if (u.tier !== tier) changeTier(u, tier, picker); },
    }, [
      el('b', { text: tierName(tier) }),
      el('small', { text: limit ? t('admin.perDay', { n: fmtNumber(limit) }) : t('admin.unlimited') }),
    ]));
  }
  sections.push(section(t('admin.tier'), [picker]));

  // Foydalanish
  const q = d.quota;
  const max = Math.max(1, ...d.daily.map((x) => x.requests));
  const chart = el('div', { class: 'usage-chart', role: 'img', 'aria-label': t('admin.chartLabel') },
    d.daily.map((day, i) => {
      const bar = el('span', {
        class: `usage-chart__bar${day.requests ? '' : ' is-empty'}${i === d.daily.length - 1 ? ' is-today' : ''}`,
        title: `${formatDay(day.date)}: ${fmtNumber(day.requests)} · ${fmtCompact(day.tokens)} ${t('admin.tokensShort')}`,
      });
      bar.style.height = `${Math.max(2, Math.round((day.requests / max) * 100))}%`;
      return bar;
    }));

  sections.push(section(t('admin.usage'), [
    meter(q.used, q.unlimited ? 0 : q.limit),
    q.resetAt ? el('p', { class: 'drawer__hint', text: t('admin.resetsAt', { time: relTime(q.resetAt) }) }) : null,
    el('div', { style: 'margin-top:18px' }, [
      chart,
      el('div', { class: 'usage-chart__axis' }, [
        el('span', { text: formatDay(d.daily[0].date) }),
        el('span', { text: t('admin.today') }),
      ]),
    ]),
    el('dl', { class: 'facts', style: 'margin-top:18px' }, [
      fact(t('admin.factRequests'), fmtNumber(u.requests)),
      fact(t('admin.factTokens'), fmtNumber(u.tokens)),
      fact(t('admin.factChats'), fmtNumber(u.chats)),
      fact(t('admin.factFiles'), fmtNumber(u.files)),
      fact(t('admin.factSessions'), fmtNumber(d.sessions)),
      fact(t('admin.factJoined'), formatDate(u.createdAt, getLanguage())),
    ]),
  ]));

  // Kirish huquqi
  const access = [];
  if (u.status === 'blocked') {
    access.push(el('div', { class: 'block-callout' }, [
      el('span', { text: u.blockReason ? t('admin.blockedWith', { reason: u.blockReason }) : t('admin.blockedNoReason') }),
      u.blockedAt ? el('small', { text: relTime(u.blockedAt) }) : null,
    ]));
    access.push(el('div', { class: 'drawer__actions' }, [
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: t('admin.unblock'), onClick: () => unblock(u) }),
    ]));
  } else if (u.role === 'admin') {
    access.push(el('p', { class: 'drawer__hint', text: isSelf ? t('admin.selfNote') : t('admin.adminNote') }));
  } else {
    const reason = el('textarea', { maxlength: '300', placeholder: t('admin.reasonPlaceholder'), 'aria-label': t('admin.reason') });
    access.push(reason);
    access.push(el('div', { class: 'drawer__actions' }, [
      el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: t('admin.block'), onClick: () => block(u, reason.value.trim()) }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: t('admin.signOutAll'), onClick: () => revokeSessions(u) }),
    ]));
    access.push(el('p', { class: 'drawer__hint', text: t('admin.blockHint') }));
  }
  sections.push(section(t('admin.access'), access));

  // Faoliyat
  if (d.activity.length) {
    sections.push(section(t('admin.activity'), [
      el('ul', { class: 'activity' }, d.activity.map((a) => el('li', {}, [
        el('span', { text: activityLabel(a), title: a.detail || '' }),
        el('time', { text: relTime(a.created_at) }),
      ]))),
    ]));
  }

  return sections;
}

const section = (title, children) => el('section', { class: 'drawer__section' }, [
  el('h4', { text: title }),
  ...children.filter(Boolean),
]);

const fact = (label, value) => el('div', {}, [el('dt', { text: label }), el('dd', { text: value })]);

/* ── Amallar ── */
async function patchUser(u, body, successText) {
  state.busy = true;
  try {
    const res = await api.adminUpdateUser(u.id, body);
    const i = state.users.findIndex((x) => x.id === u.id);
    if (i !== -1) state.users[i] = res.user;
    toast(successText, 'success', 2500);
    await Promise.all([loadDetail(u.id), refreshStatsOnly()]);
    renderTable();
    return true;
  } catch (err) {
    toast(err.message || t('error.generic'), 'error');
    return false;
  } finally {
    state.busy = false;
  }
}

async function refreshStatsOnly() {
  try {
    const stats = await api.adminStats();
    state.stats = stats.stats;
    state.limits = stats.tiers;
    renderStats();
    renderToolbarCounts();
  } catch { /* statistika keyingi yangilanishda */ }
}

async function changeTier(u, tier, picker) {
  for (const b of picker.querySelectorAll('button')) b.disabled = true;
  const ok = await patchUser(u, { tier }, t('admin.tierChanged', { name: u.fullName, tier: tierName(tier) }));
  if (!ok) for (const b of picker.querySelectorAll('button')) b.disabled = false;
}

async function block(u, reason) {
  const yes = await confirmDialog({
    title: t('admin.blockConfirmTitle', { name: u.fullName }),
    message: t('admin.blockConfirm'),
    confirmText: t('admin.block'),
    danger: true,
  });
  if (!yes) return;
  await patchUser(u, { status: 'blocked', ...(reason ? { reason } : {}) }, t('admin.blockedToast', { name: u.fullName }));
}

async function unblock(u) {
  await patchUser(u, { status: 'active' }, t('admin.unblockedToast', { name: u.fullName }));
}

async function revokeSessions(u) {
  const yes = await confirmDialog({
    title: t('admin.signOutAll'),
    message: t('admin.signOutConfirm', { name: u.fullName }),
    confirmText: t('admin.signOutAll'),
  });
  if (!yes) return;
  try {
    await api.adminRevokeSessions(u.id);
    toast(t('admin.signedOutToast'), 'success', 2500);
    await loadDetail(u.id);
  } catch (err) {
    toast(err.message || t('error.generic'), 'error');
  }
}

/* ── Formatlash ── */
const locale = () => LOCALE[getLanguage()] || 'uz-UZ';
const tierName = (tier) => t(`tier.${tier}`);
const initials = (name) => String(name || '?').trim().charAt(0).toUpperCase();
const isOnline = (u) => u.lastSeenAt && Date.now() - u.lastSeenAt < ONLINE_MS;

function fmtNumber(n) {
  return new Intl.NumberFormat(locale()).format(Number(n) || 0);
}

function fmtCompact(n) {
  return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0);
}

function formatDay(iso) {
  return formatDate(Date.parse(`${iso}T00:00:00Z`), getLanguage(), { year: false, utc: true });
}

function presence(u) {
  if (isOnline(u)) return t('admin.online');
  return u.lastSeenAt ? t('admin.lastSeen', { time: relTime(u.lastSeenAt) }) : t('admin.neverSeen');
}

const relTime = (ts) => formatRelative(ts, getLanguage());

function activityLabel(a) {
  const key = `audit.${a.type}`;
  const label = t(key);
  return label === key ? a.type : label;
}
