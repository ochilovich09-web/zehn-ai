/* Toast bildirishnomalari va modal/menyu yordamchilari */
import { $, el, renderIcons } from '../core/dom.js';
import { t } from '../core/i18n.js';

const ICONS = { info: 'info', success: 'check', error: 'warning', warn: 'warning' };

export function toast(message, type = 'info', ms = 4000) {
  const box = $('#toasts');
  if (!box) return;

  const node = el('div', { class: `toast toast--${type}` }, [
    el('i', { 'data-icon': ICONS[type] || 'info' }),
    el('div', { class: 'toast__msg', text: message }),
  ]);
  renderIcons(node);
  box.append(node);

  const remove = () => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 200);
  };
  const timer = setTimeout(remove, ms);
  node.addEventListener('click', () => { clearTimeout(timer); remove(); });
  return node;
}

/* ── Modal ── */
let modalCloser = null;

export function openModal({ title, body, footer = [], onClose }) {
  const modal = $('#modal');
  $('#modal-title').textContent = title;

  const bodyBox = $('#modal-body');
  bodyBox.replaceChildren();
  bodyBox.append(...[].concat(body));

  const footBox = $('#modal-foot');
  footBox.replaceChildren();
  if (footer.length) footBox.append(...footer);

  renderIcons(modal);
  modal.hidden = false;
  modalCloser = onClose;

  const first = bodyBox.querySelector('input, textarea, button');
  if (first) setTimeout(() => first.focus(), 60);
  return modal;
}

export function closeModal() {
  const modal = $('#modal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  modalCloser?.();
  modalCloser = null;
}

/** Tasdiqlash oynasi — Promise<boolean> qaytaradi. */
export function confirmDialog({ title, message, confirmText, danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (settled) return; settled = true; closeModal(); resolve(value); };

    openModal({
      title,
      body: el('p', { text: message, style: 'color: var(--text-2)' }),
      footer: [
        el('button', { class: 'btn btn--ghost', text: t('cancel'), onClick: () => done(false) }),
        el('button', {
          class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
          text: confirmText || t('confirm'),
          onClick: () => done(true),
        }),
      ],
      onClose: () => done(false),
    });
  });
}

/** Bitta matn maydonli oyna (masalan suhbat nomini o'zgartirish). */
export function promptDialog({ title, value = '', placeholder = '', confirmText }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; closeModal(); resolve(v); };

    const input = el('input', { type: 'text', value, placeholder, maxlength: '120' });
    const form = el('form', {
      class: 'field',
      onSubmit: (e) => { e.preventDefault(); done(input.value.trim() || null); },
    }, [input]);

    openModal({
      title,
      body: form,
      footer: [
        el('button', { class: 'btn btn--ghost', text: t('cancel'), onClick: () => done(null) }),
        el('button', { class: 'btn btn--primary', text: confirmText || t('save'), onClick: () => done(input.value.trim() || null) }),
      ],
      onClose: () => done(null),
    });
    setTimeout(() => { input.focus(); input.select(); }, 60);
  });
}

/* ── Kontekst menyu ── */
export function openMenu(anchorRect, items) {
  const menu = $('#context-menu');
  menu.replaceChildren();

  for (const item of items) {
    if (item === 'sep') { menu.append(el('hr')); continue; }
    menu.append(el('button', {
      class: item.danger ? 'is-danger' : '',
      type: 'button',
      onClick: (e) => { e.stopPropagation(); closeMenu(); item.action(); },
    }, [el('i', { 'data-icon': item.icon }), el('span', { text: item.label })]));
  }

  renderIcons(menu);
  menu.hidden = false;

  // Ekrandan chiqib ketmasligi uchun joyni to'g'rilaymiz
  const { width, height } = menu.getBoundingClientRect();
  let left = anchorRect.left;
  let top = anchorRect.bottom + 6;
  if (left + width > innerWidth - 10) left = innerWidth - width - 10;
  if (top + height > innerHeight - 10) top = anchorRect.top - height - 6;
  menu.style.left = `${Math.max(10, left)}px`;
  menu.style.top = `${Math.max(10, top)}px`;

  setTimeout(() => {
    document.addEventListener('click', closeMenu, { once: true });
    document.addEventListener('scroll', closeMenu, { once: true, capture: true });
  }, 0);
}

export function closeMenu() {
  const menu = $('#context-menu');
  if (menu) menu.hidden = true;
}

/* Global hodisalar */
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close-modal]')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); closeMenu(); }
});
