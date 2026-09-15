/* Sidebar: suhbatlar ro'yxati, qidiruv, kontekst menyu */
import { $, el, renderIcons, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { t, getLanguage } from '../core/i18n.js';
import { getState, set, subscribe } from '../core/store.js';
import { toast, confirmDialog, promptDialog, openMenu } from './toast.js';

let onSelectChat = () => {};

export function initSidebar({ onSelect, onNewChat }) {
  onSelectChat = onSelect;

  $('#btn-new-chat').addEventListener('click', onNewChat);

  const search = $('#chat-search');
  const clear = $('#search-clear');
  search.addEventListener('input', debounce(() => {
    clear.hidden = !search.value;
    set({ search: search.value.trim() });
    loadChats();
  }, 250));
  clear.addEventListener('click', () => {
    search.value = '';
    clear.hidden = true;
    set({ search: '' });
    loadChats();
  });

  $('#btn-archived').addEventListener('click', () => {
    const next = !getState().archivedView;
    set({ archivedView: next });
    $('#btn-archived').classList.toggle('is-active', next);
    $('#btn-archived').querySelector('span').textContent = next ? t('app.active') : t('app.archived');
    loadChats();
  });

  $('#btn-collapse').addEventListener('click', () => {
    $('#app-view').classList.toggle('is-collapsed');
  });
  $('#btn-menu').addEventListener('click', () => {
    $('#app-view').classList.add('is-menu-open');
  });
  $('#sidebar-scrim').addEventListener('click', () => {
    $('#app-view').classList.remove('is-menu-open');
  });

  subscribe('chats', render);
  subscribe('activeChatId', render);
}

export async function loadChats() {
  const { archivedView, search } = getState();
  try {
    const res = await api.listChats({ archived: archivedView, search });
    set({ chats: res.chats });
  } catch {
    // Tarmoq xatosi — ro'yxatni bo'sh qoldirmaymiz
  }
}

/* ── Guruhlash: bugun / kecha / 7 kun / oldingi ── */
function groupChats(chats) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const weekAgo = startOfToday - 6 * 86400000;

  const groups = { pinned: [], today: [], yesterday: [], week: [], older: [] };
  for (const chat of chats) {
    if (chat.pinned) { groups.pinned.push(chat); continue; }
    if (chat.updatedAt >= startOfToday) groups.today.push(chat);
    else if (chat.updatedAt >= startOfYesterday) groups.yesterday.push(chat);
    else if (chat.updatedAt >= weekAgo) groups.week.push(chat);
    else groups.older.push(chat);
  }
  return groups;
}

function render() {
  const list = $('#chat-list');
  const { chats, activeChatId, archivedView } = getState();
  list.replaceChildren();

  if (!chats.length) {
    list.append(el('div', { class: 'chat-empty', text: archivedView ? t('group.emptyArchive') : t('group.empty') }));
    return;
  }

  const groups = groupChats(chats);
  const titles = {
    pinned: getLanguage() === 'ru' ? 'Закрепленные' : getLanguage() === 'en' ? 'Pinned' : 'Qadalgan',
    today: t('group.today'),
    yesterday: t('group.yesterday'),
    week: t('group.week'),
    older: t('group.older'),
  };

  for (const [key, items] of Object.entries(groups)) {
    if (!items.length) continue;
    const group = el('div', { class: 'chat-group' }, [
      el('div', { class: 'chat-group__title', text: titles[key] }),
    ]);
    for (const chat of items) group.append(chatRow(chat, chat.id === activeChatId));
    list.append(group);
  }
  renderIcons(list);
}

function chatRow(chat, isActive) {
  const row = el('button', {
    class: `chat-item${isActive ? ' is-active' : ''}`,
    type: 'button',
    title: chat.title,
    onClick: () => {
      $('#app-view').classList.remove('is-menu-open');
      onSelectChat(chat.id);
    },
  }, [
    el('i', { 'data-icon': chat.pinned ? 'pin' : 'message', class: `chat-item__icon${chat.pinned ? ' chat-item__pin' : ''}` }),
    el('span', { class: 'chat-item__title', text: chat.title }),
  ]);

  const more = el('span', {
    class: 'chat-item__more',
    role: 'button',
    tabindex: '0',
    title: '...',
    onClick: (e) => {
      e.stopPropagation();
      openChatMenu(chat, e.currentTarget.getBoundingClientRect());
    },
  }, [el('i', { 'data-icon': 'dots' })]);

  row.append(more);
  return row;
}

function openChatMenu(chat, rect) {
  openMenu(rect, [
    { icon: 'edit', label: t('chat.rename'), action: () => renameChat(chat) },
    { icon: 'pin', label: chat.pinned ? t('chat.unpin') : t('chat.pin'), action: () => togglePin(chat) },
    { icon: 'archive', label: chat.archived ? t('chat.unarchive') : t('chat.archive'), action: () => toggleArchive(chat) },
    'sep',
    { icon: 'trash', label: t('chat.delete'), danger: true, action: () => removeChat(chat) },
  ]);
}

async function renameChat(chat) {
  const title = await promptDialog({ title: t('chat.renameTitle'), value: chat.title });
  if (!title || title === chat.title) return;
  try {
    await api.updateChat(chat.id, { title });
    await loadChats();
    if (getState().activeChatId === chat.id) $('#chat-title').textContent = title;
  } catch (err) { toast(err.message, 'error'); }
}

async function togglePin(chat) {
  try {
    await api.updateChat(chat.id, { pinned: !chat.pinned });
    await loadChats();
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleArchive(chat) {
  try {
    await api.updateChat(chat.id, { archived: !chat.archived });
    await loadChats();
    toast(chat.archived ? t('chat.unarchive') : t('chat.archive'), 'success', 2000);
  } catch (err) { toast(err.message, 'error'); }
}

async function removeChat(chat) {
  const confirmed = await confirmDialog({
    title: t('chat.delete'),
    message: t('chat.deleteConfirm'),
    confirmText: t('delete'),
    danger: true,
  });
  if (!confirmed) return;

  try {
    await api.deleteChat(chat.id);
    if (getState().activeChatId === chat.id) set({ activeChatId: null, messages: [] });
    await loadChats();
  } catch (err) { toast(err.message, 'error'); }
}
