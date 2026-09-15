/* Zehn AI — ilova kirish nuqtasi */
import { $, el, renderIcons } from './core/dom.js';
import { api, getToken, setToken, onAuthLost, onAccountBlocked } from './core/api.js';
import { t, setLanguage, getLanguage, detectInitialLanguage, applyTranslations, onLanguageChange, LANGS } from './core/i18n.js';
import { getState, set, applyTheme, getTheme, toggleTheme } from './core/store.js';
import { initAuth, showAuth } from './ui/auth.js';
import { initSidebar, loadChats } from './ui/sidebar.js';
import { openChat, showWelcome, renderMessages } from './ui/chat.js';
import { initComposer, fillInput, clearAttachments } from './ui/composer.js';
import { openSettings, refreshSidebarProfile, refreshQuota } from './ui/settings.js';
import { initAdmin, openAdmin, closeAdmin } from './ui/admin.js';
import { toast } from './ui/toast.js';

/* ── Ishga tushirish ── */
async function boot() {
  applyTheme(getTheme());
  setLanguage(detectInitialLanguage());
  renderIcons();
  buildLangSwitches();
  bindGlobalControls();

  initAuth((user) => enterApp(user));
  initComposer();
  initSidebar({
    onSelect: (chatId) => { closeAdmin(); openChat(chatId); },
    onNewChat: () => { closeAdmin(); showWelcome(); clearAttachments(); $('#input').focus(); },
  });
  initAdmin({ onClose: () => closeAdmin() });

  onAuthLost(() => {
    toast(t('error.session'), 'warn');
    setToken(null);
    closeAdmin();
    showAuth();
  });

  // Admin hisobni bloklasa — foydalanuvchi sababni ko'rib, kirish ekraniga qaytadi
  onAccountBlocked((err) => {
    const reason = err.details?.reason;
    toast(reason ? t('blocked.withReason', { reason }) : t('blocked.toast'), 'error', 10000);
    closeAdmin();
    set({ user: null });
    showAuth();
  });

  onLanguageChange(() => {
    applyTranslations();
    syncLangButtons();
    buildSuggestions();
    if (getState().activeChatId) renderMessages();
    refreshSidebarProfile();
  });

  // Mavjud sessiyani tekshiramiz
  let user = null;
  if (getToken()) {
    try {
      const res = await api.me();
      user = res.user;
    } catch { /* token eskirgan */ }
  }
  if (!user) {
    try {
      const res = await api.refresh();
      user = res.user;
    } catch { /* mehmon */ }
  }

  $('#boot').hidden = true;
  if (user) enterApp(user);
  else showAuth();
}

/* ── Ilovaga kirish ── */
async function enterApp(user) {
  set({ user });
  if (user.language && user.language !== getLanguage()) setLanguage(user.language);
  if (user.theme) applyTheme(user.theme);

  $('#auth-view').hidden = true;
  $('#app-view').hidden = false;

  refreshSidebarProfile();
  refreshQuota();
  buildSuggestions();
  showWelcome();

  const isAdmin = user.role === 'admin';
  $('#btn-admin').hidden = !isAdmin;
  await loadChats();

  // #/admin havolasi bilan kirilgan bo'lsa — to'g'ridan-to'g'ri admin panel
  if (isAdmin && location.hash === '#/admin') {
    openAdmin();
    return;
  }

  // Oxirgi suhbatni ochamiz
  const [firstChat] = getState().chats;
  if (firstChat) openChat(firstChat.id);
  $('#input').focus();
}

/* ── Til almashtirgichlar ── */
function buildLangSwitches() {
  for (const id of ['#auth-lang', '#app-lang']) {
    const box = $(id);
    if (!box) continue;
    box.replaceChildren();
    for (const lang of LANGS) {
      box.append(el('button', {
        type: 'button',
        class: lang.code === getLanguage() ? 'is-active' : '',
        text: lang.label,
        title: lang.name,
        dataset: { lang: lang.code },
        onClick: async () => {
          setLanguage(lang.code);
          syncLangButtons();
          if (getState().user) {
            try { await api.updateProfile({ language: lang.code }); } catch { /* mahalliy */ }
          }
        },
      }));
    }
  }
  syncLangButtons();
}

function syncLangButtons() {
  for (const button of document.querySelectorAll('.lang-switch button')) {
    button.classList.toggle('is-active', button.dataset.lang === getLanguage());
  }
}

/* ── Global boshqaruv ── */
function bindGlobalControls() {
  for (const id of ['#btn-theme', '#auth-theme']) {
    $(id)?.addEventListener('click', (e) => {
      const next = toggleTheme();
      const holder = e.currentTarget.querySelector('i');
      holder.replaceChildren();
      holder.dataset.icon = next === 'dark' ? 'moon' : 'sun';
      renderIcons(e.currentTarget);
      if (getState().user) api.updateProfile({ theme: next }).catch(() => {});
    });
  }

  $('#btn-profile')?.addEventListener('click', openSettings);
  $('#btn-admin')?.addEventListener('click', () => {
    $('#app-view').classList.remove('is-menu-open');
    openAdmin();
  });
  $('#btn-avatar')?.addEventListener('click', openSettings);

  $('#btn-chat-menu')?.addEventListener('click', async () => {
    const { activeChatId, messages } = getState();
    if (!activeChatId || !messages.length) { openSettings(); return; }
    exportChat();
  });

  // Klaviatura qisqartmalari
  document.addEventListener('keydown', (e) => {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#chat-search')?.focus(); }
    if (meta && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#btn-new-chat')?.click(); }
  });
}

/** Joriy suhbatni matn fayl sifatida saqlash */
function exportChat() {
  const { messages } = getState();
  const title = $('#chat-title').textContent;
  const lines = messages.map((m) => {
    const who = m.role === 'user' ? t('msg.you') : 'Zehn AI';
    return `## ${who}\n\n${m.content}\n`;
  });
  const blob = new Blob([`# ${title}\n\n${lines.join('\n')}`], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `${title.replace(/[^\w\s-]/g, '').trim() || 'chat'}.md` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── Taklif kartochkalari ── */
function buildSuggestions() {
  const box = $('#suggestions');
  if (!box) return;
  const items = [
    { icon: 'code', key: '1' },
    { icon: 'briefcase', key: '2' },
    { icon: 'file-text', key: '3' },
    { icon: 'graduation', key: '4' },
  ];
  box.replaceChildren();
  for (const item of items) {
    const text = t(`sug.${item.key}.text`);
    box.append(el('button', {
      class: 'suggestion',
      type: 'button',
      onClick: () => fillInput(text),
    }, [
      el('i', { 'data-icon': item.icon }),
      el('span', {}, [
        el('b', { text: t(`sug.${item.key}.title`) }),
        el('small', { text }),
      ]),
    ]));
  }
  renderIcons(box);
}

boot().catch((err) => {
  console.error('Boot error:', err);
  $('#boot').hidden = true;
  showAuth();
});
