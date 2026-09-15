/* Profil va sozlamalar oynasi */
import { $, el, renderIcons, formatDate } from '../core/dom.js';
import { api, setToken } from '../core/api.js';
import { t, setLanguage, getLanguage, LANGS } from '../core/i18n.js';
import { getState, set, applyTheme } from '../core/store.js';
import { toast, openModal, closeModal, confirmDialog } from './toast.js';

const AVATAR_MAX = 256;           // piksel
const AVATAR_LIMIT = 140 * 1024;  // bayt

export function openSettings() {
  const { user } = getState();
  if (!user) return;

  const body = el('div', {}, [
    profileSection(user),
    appearanceSection(user),
    notificationsSection(user),
    securitySection(),
    dataSection(),
    statsSection(),
  ]);

  openModal({
    title: t('settings.title'),
    body,
    footer: [
      el('button', {
        class: 'btn btn--ghost',
        onClick: () => logout(),
      }, [el('i', { 'data-icon': 'logout' }), el('span', { text: t('logout') })]),
      el('button', { class: 'btn btn--primary', text: t('close'), onClick: closeModal }),
    ],
  });

  renderIcons($('#modal'));
  loadSessions();
  loadStats();
}

/* ── Profil ── */
function profileSection(user) {
  const avatar = el('span', { class: 'avatar', style: 'width:56px;height:56px;font-size:20px', text: initials(user.fullName) });
  if (user.avatar) { avatar.style.backgroundImage = `url("${user.avatar}")`; avatar.textContent = ''; }

  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file);
      const res = await api.updateProfile({ avatar: dataUrl });
      set({ user: res.user });
      avatar.style.backgroundImage = `url("${dataUrl}")`;
      avatar.textContent = '';
      refreshSidebarProfile();
      toast(t('settings.saved'), 'success', 2000);
    } catch (err) {
      toast(err.message || t('error.generic'), 'error');
    }
  });

  const nameInput = el('input', { type: 'text', value: user.fullName, maxlength: '80' });
  let saveTimer;
  nameInput.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const value = nameInput.value.trim();
      if (value.length < 2) return;
      try {
        const res = await api.updateProfile({ fullName: value });
        set({ user: res.user });
        avatar.textContent = user.avatar ? '' : initials(value);
        refreshSidebarProfile();
      } catch (err) { toast(err.message, 'error'); }
    }, 700);
  });

  const emailRow = el('div', { class: 'settings-row' }, [
    el('div', { class: 'settings-row__label' }, [
      el('b', { text: user.email }),
      el('small', { text: user.emailVerified ? 'Email tasdiqlangan' : t('settings.emailNotVerified') }),
    ]),
    user.emailVerified ? el('span', { class: 'chip', text: 'OK' })
      : el('button', {
        class: 'btn btn--ghost btn--sm',
        text: t('settings.verifyNow'),
        onClick: async (e) => {
          e.target.disabled = true;
          try {
            const res = await api.resendVerification();
            toast(t('success.mailSent'), 'success');
            if (res.devVerifyLink) console.info('Dev verify link:', res.devVerifyLink);
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
  ]);

  return section(t('settings.profile'), [
    el('div', { style: 'display:flex;align-items:center;gap:16px;padding:12px 0' }, [
      avatar,
      el('div', { style: 'flex:1' }, [
        el('div', { style: 'display:flex;gap:8px;margin-bottom:6px' }, [
          el('button', { class: 'btn btn--ghost btn--sm', text: t('settings.upload'), onClick: () => fileInput.click() }),
          user.avatar ? el('button', {
            class: 'btn btn--ghost btn--sm',
            text: t('settings.removeAvatar'),
            onClick: async () => {
              const res = await api.updateProfile({ avatar: null });
              set({ user: res.user });
              avatar.style.backgroundImage = '';
              avatar.textContent = initials(res.user.fullName);
              refreshSidebarProfile();
            },
          }) : null,
        ]),
        el('small', { style: 'color:var(--text-3);font-size:12px', text: t('settings.avatarHint') }),
      ]),
      fileInput,
    ]),
    el('label', { class: 'field' }, [el('span', { text: t('field.fullName') }), nameInput]),
    emailRow,
  ]);
}

/* ── Ko'rinish ── */
function appearanceSection(user) {
  const langSwitch = el('div', { class: 'lang-switch' });
  for (const lang of LANGS) {
    langSwitch.append(el('button', {
      type: 'button',
      class: lang.code === getLanguage() ? 'is-active' : '',
      text: lang.label,
      title: lang.name,
      onClick: async () => {
        setLanguage(lang.code);
        for (const b of langSwitch.children) b.classList.toggle('is-active', b.textContent === lang.label);
        try {
          const res = await api.updateProfile({ language: lang.code });
          set({ user: res.user });
        } catch { /* mahalliy o'zgarish saqlanadi */ }
        closeModal();
        openSettings();
      },
    }));
  }

  const themes = [
    { key: 'light', icon: 'sun', label: t('settings.themeLight') },
    { key: 'dark', icon: 'moon', label: t('settings.themeDark') },
    { key: 'system', icon: 'monitor', label: t('settings.themeSystem') },
  ];
  const picker = el('div', { class: 'theme-picker' });
  const current = document.documentElement.dataset.theme;
  for (const theme of themes) {
    picker.append(el('button', {
      type: 'button',
      class: theme.key === current ? 'is-active' : '',
      onClick: async () => {
        applyTheme(theme.key);
        for (const b of picker.children) b.classList.remove('is-active');
        picker.children[themes.indexOf(theme)].classList.add('is-active');
        try {
          const res = await api.updateProfile({ theme: theme.key });
          set({ user: res.user });
        } catch { /* mahalliy o'zgarish saqlanadi */ }
      },
    }, [el('i', { 'data-icon': theme.icon }), el('span', { text: theme.label })]));
  }

  return section(t('settings.appearance'), [
    row(t('settings.language'), null, langSwitch),
    el('div', { style: 'padding:12px 0' }, [
      el('div', { class: 'settings-row__label', style: 'margin-bottom:10px' }, [el('b', { text: t('settings.theme') })]),
      picker,
    ]),
  ]);
}

function notificationsSection(user) {
  const toggle = el('label', { class: 'switch' }, [
    el('input', {
      type: 'checkbox',
      checked: user.notifications,
      onChange: async (e) => {
        try {
          const res = await api.updateProfile({ notifications: e.target.checked });
          set({ user: res.user });
        } catch (err) { toast(err.message, 'error'); }
      },
    }),
    el('span'),
  ]);
  return section(null, [row(t('settings.notifications'), t('settings.notificationsHint'), toggle)]);
}

/* ── Xavfsizlik ── */
function securitySection() {
  const sessionsBox = el('div', { id: 'sessions-box', style: 'padding-top:4px' }, [
    el('small', { style: 'color:var(--text-3)', text: '...' }),
  ]);

  return section(t('settings.security'), [
    row(t('settings.changePassword'), null,
      el('button', { class: 'btn btn--ghost btn--sm', text: t('settings.changePassword'), onClick: openPasswordDialog })),
    el('div', { style: 'padding:12px 0' }, [
      el('div', { class: 'settings-row__label', style: 'margin-bottom:6px' }, [
        el('b', { text: t('settings.sessions') }),
        el('small', { text: t('settings.sessionsHint') }),
      ]),
      sessionsBox,
      el('button', {
        class: 'btn btn--ghost btn--sm',
        style: 'margin-top:10px',
        text: t('settings.revokeAll'),
        onClick: async () => {
          const yes = await confirmDialog({ title: t('settings.revokeAll'), message: t('settings.sessionsHint'), danger: true });
          if (!yes) return;
          await api.revokeAllSessions();
          logout();
        },
      }),
    ]),
  ]);
}

async function loadSessions() {
  const box = $('#sessions-box');
  if (!box) return;
  try {
    const res = await api.sessions();
    box.replaceChildren();
    for (const session of res.sessions) {
      box.append(el('div', { class: 'session-item' }, [
        el('i', { 'data-icon': 'monitor' }),
        el('div', { class: 'session-item__meta' }, [
          el('b', { text: session.device }),
          el('small', { text: `${session.ip || '—'} · ${formatDate(session.lastSeen, getLanguage())}` }),
        ]),
        el('button', {
          class: 'link',
          text: t('settings.revoke'),
          onClick: async (e) => {
            e.target.disabled = true;
            try {
              await api.revokeSession(session.id);
              loadSessions();
            } catch (err) { toast(err.message, 'error'); }
          },
        }),
      ]));
    }
    if (!res.sessions.length) box.append(el('small', { style: 'color:var(--text-3)', text: '—' }));
    renderIcons(box);
  } catch { /* sessiyalar yuklanmadi */ }
}

function openPasswordDialog() {
  const currentInput = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  const newInput = el('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });

  const form = el('form', {}, [
    el('label', { class: 'field' }, [el('span', { text: t('field.currentPassword') }), currentInput]),
    el('label', { class: 'field' }, [el('span', { text: t('field.newPassword') }), newInput]),
  ]);

  const submit = async () => {
    try {
      await api.changePassword(currentInput.value, newInput.value);
      toast(t('success.reset'), 'success');
      closeModal();
      setTimeout(() => logout(), 900);
    } catch (err) { toast(err.message, 'error'); }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

  openModal({
    title: t('settings.changePassword'),
    body: form,
    footer: [
      el('button', { class: 'btn btn--ghost', text: t('cancel'), onClick: () => { closeModal(); openSettings(); } }),
      el('button', { class: 'btn btn--primary', text: t('save'), onClick: submit }),
    ],
  });
}

/* ── Ma'lumotlar ── */
function dataSection() {
  return section(t('settings.data'), [
    row(t('settings.export'), t('settings.exportHint'),
      el('button', {
        class: 'btn btn--ghost btn--sm',
        onClick: () => { location.href = '/api/user/export'; },
      }, [el('i', { 'data-icon': 'download' }), el('span', { text: t('settings.export') })])),
    row(t('settings.deleteAccount'), t('settings.deleteAccountHint'),
      el('button', { class: 'link', style: 'color:var(--danger)', text: t('delete'), onClick: openDeleteAccount })),
  ]);
}

function openDeleteAccount() {
  const passwordInput = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  openModal({
    title: t('settings.deleteAccount'),
    body: el('div', {}, [
      el('p', { style: 'color:var(--text-2);margin-bottom:14px', text: t('settings.deleteAccountHint') }),
      el('label', { class: 'field' }, [el('span', { text: t('field.password') }), passwordInput]),
    ]),
    footer: [
      el('button', { class: 'btn btn--ghost', text: t('cancel'), onClick: () => { closeModal(); openSettings(); } }),
      el('button', {
        class: 'btn btn--danger',
        text: t('delete'),
        onClick: async () => {
          try {
            await api.deleteAccount(passwordInput.value);
            setToken(null);
            location.reload();
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
    ],
  });
}

/* ── Statistika ── */
function statsSection() {
  return section(t('settings.stats'), [
    el('div', { id: 'stats-box', class: 'analysis__grid', style: 'padding:10px 0' }),
  ]);
}

async function loadStats() {
  const box = $('#stats-box');
  if (!box) return;
  try {
    const res = await api.stats();
    const cells = [
      [t('settings.statChats'), res.stats.chats],
      [t('settings.statMessages'), res.stats.messages],
      [t('settings.statFiles'), res.stats.files],
      [t('settings.aiMode'), { gemini: 'Gemini', anthropic: 'Anthropic' }[res.stats.aiMode] || 'Local'],
    ];
    box.replaceChildren(...cells.map(([label, value]) =>
      el('div', { class: 'analysis__cell' }, [el('small', { text: label }), el('b', { text: String(value) })])));
  } catch { /* statistika yuklanmadi */ }
}

/* ── Yordamchilar ── */
function section(title, children) {
  const box = el('div', { style: 'margin-bottom:22px' });
  if (title) {
    box.append(el('h4', {
      style: 'font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px',
      text: title,
    }));
  }
  box.append(...children.filter(Boolean));
  return box;
}

function row(label, hint, control) {
  return el('div', { class: 'settings-row' }, [
    el('div', { class: 'settings-row__label' }, [
      el('b', { text: label }),
      hint ? el('small', { text: hint }) : null,
    ].filter(Boolean)),
    control,
  ]);
}

export function initials(name) {
  return String(name || '?').trim().charAt(0).toUpperCase();
}

export function refreshSidebarProfile() {
  const { user } = getState();
  if (!user) return;
  $('#side-name').textContent = user.fullName;

  for (const node of [$('#side-avatar'), $('#btn-avatar')]) {
    if (!node) continue;
    if (user.avatar) {
      node.style.backgroundImage = `url("${user.avatar}")`;
      node.textContent = '';
    } else {
      node.style.backgroundImage = '';
      node.textContent = initials(user.fullName);
    }
  }
}

/** Rasmni kvadrat qilib kichraytiradi va base64 ga o'giradi. */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Faylni o‘qib bo‘lmadi'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Rasm formati noto‘g‘ri'));
      img.onload = () => {
        const size = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = AVATAR_MAX;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, AVATAR_MAX, AVATAR_MAX);

        let quality = 0.85;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > AVATAR_LIMIT && quality > 0.35) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        if (dataUrl.length > AVATAR_LIMIT) reject(new Error('Rasm juda katta'));
        else resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function logout() {
  try { await api.logout(); } catch { /* baribir chiqamiz */ }
  setToken(null);
  location.reload();
}
