/* Xabar kiritish paneli: matn, fayl biriktirish, mikrofon */
import { $, el, renderIcons, formatBytes } from '../core/dom.js';
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getState, set } from '../core/store.js';
import { toast } from './toast.js';
import { sendMessage, stopStreaming } from './chat.js';
import { startRecording, stopRecording, isRecording } from './voice.js';

const KIND_ICON = { document: 'file-text', text: 'file-text', data: 'table', spreadsheet: 'table', image: 'image' };

export function initComposer() {
  const form = $('#composer');
  const input = $('#input');
  const send = $('#btn-send');

  /* Avtomatik balandlik */
  const autoGrow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
    send.disabled = !input.value.trim() || getState().streaming;
  };
  input.addEventListener('input', autoGrow);

  /* Enter = yuborish, Shift+Enter = yangi qator */
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || getState().streaming) return;

    const pendingFiles = getState().attachments;
    const fileIds = pendingFiles.map((f) => f.id);
    input.value = '';
    autoGrow();
    clearAttachments();

    const sent = await sendMessage(text, fileIds);
    // Server rad etsa (limit va h.k.) — yozilgan matn va fayllar yo'qolmasin
    if (!sent && !input.value) {
      input.value = text;
      set({ attachments: pendingFiles });
      renderAttachments();
      autoGrow();
    }
    input.focus();
  });

  $('#btn-stop').addEventListener('click', () => stopStreaming());

  /* Fayl biriktirish */
  const fileInput = $('#file-input');
  $('#btn-attach').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    uploadFiles([...fileInput.files]);
    fileInput.value = '';
  });

  /* Drag & drop */
  const thread = $('#thread');
  for (const type of ['dragover', 'drop']) {
    thread.addEventListener(type, (e) => {
      e.preventDefault();
      if (type === 'drop') uploadFiles([...e.dataTransfer.files]);
    });
  }

  /* Buferdan rasm qo'yish */
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); uploadFiles(files); }
  });

  /* Mikrofon */
  $('#btn-mic').addEventListener('click', () => {
    if (isRecording()) { stopRecording(); return; }
    startRecording((text) => {
      input.value = text;
      autoGrow();
    });
  });
  $('#rec-stop').addEventListener('click', () => stopRecording());

  /* Fayl turlarini serverdan olamiz */
  api.config().then((cfg) => {
    set({ config: cfg });
    fileInput.accept = cfg.uploads.accept.join(',');
  }).catch(() => { /* keyinroq qayta urinamiz */ });

  autoGrow();
}

/* ── Fayllarni yuklash ── */
async function uploadFiles(files) {
  if (!files.length) return;
  const cfg = getState().config;
  const maxPerMessage = cfg?.uploads.maxPerMessage ?? 5;
  const maxSize = cfg?.uploads.maxSize ?? 10485760;
  const current = getState().attachments;

  if (current.length + files.length > maxPerMessage) {
    toast(t('file.tooMany', { n: maxPerMessage }), 'warn');
    return;
  }

  const oversized = files.find((f) => f.size > maxSize);
  if (oversized) {
    toast(t('file.tooLarge', { n: Math.round(maxSize / 1048576) }), 'warn');
    return;
  }

  const form = new FormData();
  for (const file of files) form.append('files', file);

  const loading = toast(t('file.uploading'), 'info', 30000);
  try {
    const res = await api.uploadFiles(form);
    loading?.remove();
    set({ attachments: [...getState().attachments, ...res.files] });
    renderAttachments();
    toast(t('file.uploaded'), 'success', 2000);

    for (const file of res.files) {
      if (file.scanStatus === 'suspicious') toast(`${file.name}: ${file.scanNote || t('file.suspicious')}`, 'warn', 8000);
    }
  } catch (err) {
    loading?.remove();
    toast(err.message || t('error.generic'), 'error', 6000);
  }
}

function renderAttachments() {
  const box = $('#attachments');
  const files = getState().attachments;
  box.replaceChildren();
  box.hidden = !files.length;

  for (const file of files) {
    box.append(el('span', { class: 'file-pill' }, [
      el('i', { 'data-icon': KIND_ICON[file.kind] || 'file' }),
      el('b', { text: file.name }),
      el('small', { text: formatBytes(file.size) }),
      el('button', {
        class: 'file-pill__x',
        type: 'button',
        title: t('file.remove'),
        onClick: () => removeAttachment(file.id),
      }, [el('i', { 'data-icon': 'x' })]),
    ]));
  }
  renderIcons(box);
}

async function removeAttachment(id) {
  set({ attachments: getState().attachments.filter((f) => f.id !== id) });
  renderAttachments();
  try { await api.deleteFile(id); } catch { /* server tozalashi mumkin */ }
}

export function clearAttachments() {
  set({ attachments: [] });
  renderAttachments();
}

/** Taklif kartochkasidan matn qo'yish */
export function fillInput(text) {
  const input = $('#input');
  input.value = text;
  input.dispatchEvent(new Event('input'));
  input.focus();
}
