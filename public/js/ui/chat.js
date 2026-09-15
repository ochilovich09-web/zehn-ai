/* Suhbat oynasi: xabarlarni chizish, AI javobini oqim bilan ko'rsatish */
import { $, el, renderIcons, formatTime, formatBytes, escapeHtml } from '../core/dom.js';
import { api, streamRequest } from '../core/api.js';
import { t, getLanguage } from '../core/i18n.js';
import { getState, set } from '../core/store.js';
import { renderMarkdown } from './markdown.js';
import { toast, confirmDialog } from './toast.js';
import { speak, stopSpeaking, isSpeaking } from './voice.js';
import { loadChats } from './sidebar.js';
import { refreshQuota } from './settings.js';

const STAGES = ['context_analysis', 'problem_detection', 'reasoning', 'solution'];
let abortController = null;

const KIND_ICON = { document: 'file-text', text: 'file-text', data: 'table', spreadsheet: 'table', image: 'image' };

const MODE_LABEL = {
  gemini: 'Google Gemini',
  anthropic: 'Anthropic',
  local: 'Local engine',
  local_fallback: 'Local (zaxira)',
};

/* ── Suhbatni ochish ── */
export async function openChat(chatId) {
  set({ activeChatId: chatId });
  try {
    const res = await api.getChat(chatId);
    set({ messages: res.messages, attachments: [] });
    $('#chat-title').textContent = res.chat.title;
    setDomainChip(res.chat.domain);
    renderMessages();
  } catch (err) {
    toast(err.message, 'error');
  }
}

export function showWelcome() {
  set({ activeChatId: null, messages: [] });
  $('#chat-title').textContent = t('app.newChat');
  setDomainChip(null);
  $('#messages').replaceChildren();
  $('#welcome').hidden = false;
}

function setDomainChip(domain) {
  const chip = $('#chat-domain');
  if (!domain) { chip.hidden = true; return; }
  chip.hidden = false;
  chip.textContent = domainLabel(domain);
}

const DOMAIN_LABELS = {
  uz: { programming: 'Dasturlash', math: 'Matematika', business: 'Biznes', planning: 'Rejalashtirish', education: 'Ta’lim', documents: 'Hujjatlar', technical_support: 'Texnik yordam', creative: 'Ijod', work_project: 'Loyiha', personal: 'Shaxsiy', technology: 'Texnologiya', daily: 'Kundalik', general: 'Umumiy' },
  ru: { programming: 'Программирование', math: 'Математика', business: 'Бизнес', planning: 'Планирование', education: 'Образование', documents: 'Документы', technical_support: 'Техподдержка', creative: 'Творчество', work_project: 'Проект', personal: 'Личное', technology: 'Технологии', daily: 'Быт', general: 'Общее' },
  en: { programming: 'Programming', math: 'Mathematics', business: 'Business', planning: 'Planning', education: 'Education', documents: 'Documents', technical_support: 'Tech support', creative: 'Creative', work_project: 'Project', personal: 'Personal', technology: 'Technology', daily: 'Everyday', general: 'General' },
};
const domainLabel = (d) => DOMAIN_LABELS[getLanguage()]?.[d] || d;

/* ── Xabarlarni chizish ── */
export function renderMessages() {
  const box = $('#messages');
  const { messages } = getState();
  box.replaceChildren();
  $('#welcome').hidden = messages.length > 0;

  for (const message of messages) box.append(messageNode(message));
  renderIcons(box);
  scrollToBottom();
}

function messageNode(message) {
  return message.role === 'user' ? userMessage(message) : aiMessage(message);
}

function userMessage(message) {
  const { user } = getState();
  const initials = (user?.fullName || 'S').trim().charAt(0).toUpperCase();

  const body = el('div', { class: 'msg__body' }, [
    el('div', { class: 'msg__head' }, [
      el('span', { class: 'msg__name', text: t('msg.you') }),
      el('span', { class: 'msg__time', text: formatTime(message.createdAt, getLanguage()) }),
    ]),
  ]);

  const files = message.meta?.attachments || [];
  if (files.length) {
    body.append(el('div', { class: 'msg__files' }, files.map((f) => el('span', { class: 'file-pill' }, [
      el('i', { 'data-icon': KIND_ICON[f.kind] || 'file' }),
      el('b', { text: f.name }),
      el('small', { text: formatBytes(f.size || 0) }),
    ]))));
  }

  body.append(el('div', { class: 'msg__content', text: message.content }));

  const avatar = el('div', { class: 'msg__avatar', text: initials });
  if (user?.avatar) { avatar.style.backgroundImage = `url("${user.avatar}")`; avatar.textContent = ''; }

  return el('div', { class: 'msg msg--user', dataset: { id: message.id } }, [avatar, body]);
}

function aiMessage(message) {
  const content = el('div', { class: 'md' });
  content.innerHTML = renderMarkdown(message.content);

  const body = el('div', { class: 'msg__body' }, [
    el('div', { class: 'msg__head' }, [
      el('span', { class: 'msg__name', text: 'Zehn AI' }),
      el('span', { class: 'msg__time', text: formatTime(message.createdAt, getLanguage()) }),
    ]),
  ]);

  if (message.meta?.analysis) body.append(analysisPanel(message.meta));
  body.append(content);
  body.append(messageActions(message, content));

  const node = el('div', { class: 'msg msg--ai', dataset: { id: message.id } }, [
    el('div', { class: 'msg__avatar', text: 'Z' }),
    body,
  ]);
  renderIcons(node);
  bindCodeCopy(node);
  return node;
}

/* ── AI tahlili paneli ── */
function analysisPanel(meta) {
  const a = meta.analysis || {};
  const cells = [
    [t('analysis.domain'), domainLabel(a.domain)],
    [t('analysis.intent'), a.intent],
    [t('analysis.complexity'), a.complexity],
    [t('analysis.confidence'), a.domainConfidence ? `${Math.round(a.domainConfidence * 100)}%` : '—'],
    [t('analysis.mode'), MODE_LABEL[meta.mode] || 'Local engine'],
    [t('analysis.time'), meta.elapsedMs ? `${(meta.elapsedMs / 1000).toFixed(1)}s` : '—'],
  ];

  const panel = el('div', { class: 'analysis' }, [
    el('button', {
      class: 'analysis__head',
      type: 'button',
      onClick: (e) => e.currentTarget.parentElement.classList.toggle('is-open'),
    }, [
      el('i', { 'data-icon': 'brain' }),
      el('span', { text: t('msg.analysis') }),
      el('i', { 'data-icon': 'chevron' }),
    ]),
    el('div', { class: 'analysis__body' }, [
      el('div', { class: 'analysis__grid' }, cells.map(([label, value]) =>
        el('div', { class: 'analysis__cell' }, [
          el('small', { text: label }),
          el('b', { text: String(value ?? '—') }),
        ]))),
    ]),
  ]);
  renderIcons(panel);
  return panel;
}

/* ── Xabar ostidagi tugmalar ── */
function messageActions(message, contentNode) {
  const copyBtn = el('button', { class: 'msg__action', type: 'button' }, [
    el('i', { 'data-icon': 'copy' }), el('span', { text: t('msg.copy') }),
  ]);
  copyBtn.addEventListener('click', async () => {
    await copyText(message.content);
    copyBtn.classList.add('is-done');
    copyBtn.querySelector('span').textContent = t('msg.copied');
    setTimeout(() => {
      copyBtn.classList.remove('is-done');
      copyBtn.querySelector('span').textContent = t('msg.copy');
    }, 1800);
  });

  const speakBtn = el('button', { class: 'msg__action', type: 'button' }, [
    el('i', { 'data-icon': 'volume' }), el('span', { text: t('msg.readAloud') }),
  ]);
  speakBtn.addEventListener('click', () => {
    if (isSpeaking()) {
      stopSpeaking();
      speakBtn.classList.remove('is-playing');
      speakBtn.querySelector('span').textContent = t('msg.readAloud');
      return;
    }
    const plain = contentNode.textContent.trim();
    speakBtn.classList.add('is-playing');
    speakBtn.querySelector('span').textContent = t('msg.stopAudio');
    speak(plain, message.meta?.analysis?.language || getLanguage(), () => {
      speakBtn.classList.remove('is-playing');
      speakBtn.querySelector('span').textContent = t('msg.readAloud');
    });
  });

  const regenBtn = el('button', { class: 'msg__action', type: 'button' }, [
    el('i', { 'data-icon': 'refresh' }), el('span', { text: t('msg.regenerate') }),
  ]);
  regenBtn.addEventListener('click', () => regenerate());

  const box = el('div', { class: 'msg__actions' }, [copyBtn, speakBtn, regenBtn]);
  renderIcons(box);
  return box;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function bindCodeCopy(root) {
  for (const button of root.querySelectorAll('[data-copy-code]')) {
    button.addEventListener('click', async () => {
      const block = button.closest('.code-block');
      await copyText(decodeURIComponent(block.dataset.code || ''));
      button.classList.add('is-done');
      button.querySelector('span').textContent = t('msg.copied');
      setTimeout(() => {
        button.classList.remove('is-done');
        button.querySelector('span').textContent = 'Copy';
      }, 1800);
    });
  }
}

/* ── Xabar yuborish (SSE oqimi) ── */
export async function sendMessage(text, fileIds = []) {
  const state = getState();
  if (state.streaming) return;

  let chatId = state.activeChatId;
  let createdNew = false;
  if (!chatId) {
    const res = await api.createChat();
    chatId = res.chat.id;
    createdNew = true;
    set({ activeChatId: chatId });
  }

  set({ streaming: true });
  toggleSendUI(true);
  $('#welcome').hidden = true;

  const box = $('#messages');
  const placeholder = pendingMessage();
  box.append(placeholder.node);
  scrollToBottom();

  abortController = new AbortController();
  let answer = '';
  let finalMessage = null;
  let titleChanged = false;
  let accepted = false;          // server xabarni qabul qildimi (user_message keldimi)

  try {
    await streamRequest(`/api/chat/chats/${chatId}/messages`, { content: text, fileIds }, (event, data) => {
      if (event === 'user_message') {
        accepted = true;
        box.insertBefore(userMessage(data.message), placeholder.node);
        renderIcons(box);
        set({ messages: [...getState().messages, data.message] });
        scrollToBottom();
      }

      if (event === 'stage') placeholder.setStage(data.stage);

      if (event === 'analysis') placeholder.setAnalysis(data);

      if (event === 'warning') toast(`${data.file}: ${data.note}`, 'warn', 7000);

      if (event === 'delta') {
        answer += data.text;
        placeholder.appendText(answer);
      }

      if (event === 'title') {
        $('#chat-title').textContent = data.title;
        setDomainChip(data.domain);
        titleChanged = true;
      }

      if (event === 'done') finalMessage = data.message;

      if (event === 'error') toast(data.message || t('error.generic'), 'error');
    }, abortController.signal);
  } catch (err) {
    if (err.name !== 'AbortError') showRequestError(err);
  } finally {
    set({ streaming: false });
    toggleSendUI(false);
    abortController = null;
  }

  placeholder.node.remove();

  // Server xabarni umuman qabul qilmagan bo'lsa (limit, blok, tarmoq) — soxta javob chiqarmaymiz
  if (!accepted) {
    if (createdNew) loadChats();
    if (!getState().messages.length) $('#welcome').hidden = false;
    return null;
  }

  refreshQuota();

  const message = finalMessage || {
    id: `local_${Date.now()}`,
    role: 'assistant',
    content: answer || t('msg.stopped'),
    createdAt: Date.now(),
    meta: null,
  };
  set({ messages: [...getState().messages, message] });
  box.append(messageNode(message));
  renderIcons(box);
  scrollToBottom();

  // Yangi suhbat yaratilgan yoki sarlavha o'zgargan bo'lsa — yon panelni yangilaymiz
  if (createdNew || titleChanged) loadChats();

  notifyDone();
  return message;
}

export async function regenerate() {
  const state = getState();
  if (state.streaming || !state.activeChatId) return;

  const confirmed = await confirmDialog({
    title: t('msg.regenerate'),
    message: getLanguage() === 'ru' ? 'Предыдущий ответ будет заменен. Продолжить?'
      : getLanguage() === 'en' ? 'The previous answer will be replaced. Continue?'
        : 'Oldingi javob almashtiriladi. Davom etasizmi?',
    confirmText: t('msg.regenerate'),
  });
  if (!confirmed) return;

  // Oxirgi AI javobini olib tashlaymiz
  const messages = [...state.messages];
  const lastAiIndex = messages.map((m) => m.role).lastIndexOf('assistant');
  if (lastAiIndex !== -1) messages.splice(lastAiIndex, 1);
  set({ messages });
  renderMessages();

  set({ streaming: true });
  toggleSendUI(true);

  const box = $('#messages');
  const placeholder = pendingMessage();
  box.append(placeholder.node);
  scrollToBottom();

  abortController = new AbortController();
  let answer = '';
  let finalMessage = null;
  let accepted = false;
  const chatId = state.activeChatId;

  try {
    await streamRequest(`/api/chat/chats/${chatId}/regenerate`, {}, (event, data) => {
      accepted = true;
      if (event === 'stage') placeholder.setStage(data.stage);
      if (event === 'analysis') placeholder.setAnalysis(data);
      if (event === 'delta') { answer += data.text; placeholder.appendText(answer); }
      if (event === 'done') finalMessage = data.message;
    }, abortController.signal);
  } catch (err) {
    if (err.name !== 'AbortError') showRequestError(err);
  } finally {
    set({ streaming: false });
    toggleSendUI(false);
    abortController = null;
  }

  placeholder.node.remove();

  // Server rad etgan bo'lsa (masalan limit) — eski javob serverda saqlangan, uni qayta ko'rsatamiz
  if (!accepted) {
    if (getState().activeChatId === chatId) await openChat(chatId);
    return;
  }

  refreshQuota();
  const message = finalMessage || { id: `local_${Date.now()}`, role: 'assistant', content: answer, createdAt: Date.now(), meta: null };
  set({ messages: [...getState().messages, message] });
  box.append(messageNode(message));
  renderIcons(box);
  scrollToBottom();
}

/** So'rov xatosini foydalanuvchiga tushunarli ko'rinishda ko'rsatadi. */
function showRequestError(err) {
  if (err.code === 'TIER_LIMIT') {
    toast(t('limit.reached', { limit: err.details?.limit ?? '' }), 'warn', 9000);
    refreshQuota();
    return;
  }
  // Bloklash xabarini main.js ko'rsatadi
  if (err.code === 'ACCOUNT_BLOCKED') return;
  toast(err.message || t('error.network'), 'error');
}

export function stopStreaming() {
  abortController?.abort();
}

/* ── "Yozilmoqda" holati ── */
function pendingMessage() {
  const stageBox = el('div', { class: 'pipeline' });
  const stageNodes = {};
  const stageLabels = {
    context_analysis: { uz: 'Kontekst', ru: 'Контекст', en: 'Context' },
    problem_detection: { uz: 'Muammo', ru: 'Проблема', en: 'Problem' },
    reasoning: { uz: 'Mulohaza', ru: 'Анализ', en: 'Reasoning' },
    solution: { uz: 'Yechim', ru: 'Решение', en: 'Solution' },
  };

  for (const stage of STAGES) {
    const node = el('span', { class: 'pipeline__step' }, [
      el('span', { class: 'dot' }),
      el('span', { text: stageLabels[stage][getLanguage()] || stageLabels[stage].uz }),
    ]);
    stageNodes[stage] = node;
    stageBox.append(node);
  }

  const typing = el('div', { class: 'typing' }, [el('span'), el('span'), el('span')]);
  const content = el('div', { class: 'md' });
  const analysisSlot = el('div');

  const body = el('div', { class: 'msg__body' }, [
    el('div', { class: 'msg__head' }, [
      el('span', { class: 'msg__name', text: 'Zehn AI' }),
      el('span', { class: 'msg__time', text: t('msg.thinking') }),
    ]),
    stageBox,
    analysisSlot,
    typing,
    content,
  ]);

  const node = el('div', { class: 'msg msg--ai' }, [
    el('div', { class: 'msg__avatar', text: 'Z' }),
    body,
  ]);

  let cursor = null;

  return {
    node,
    setStage(stage) {
      let reached = false;
      for (const s of STAGES) {
        const n = stageNodes[s];
        if (s === stage) { n.classList.add('is-active'); n.classList.remove('is-done'); reached = true; }
        else if (!reached) { n.classList.remove('is-active'); n.classList.add('is-done'); }
      }
    },
    setAnalysis(data) {
      analysisSlot.replaceChildren(analysisPanel({ analysis: data, mode: null }));
    },
    appendText(fullText) {
      typing.hidden = true;
      stageBox.hidden = true;
      content.innerHTML = renderMarkdown(fullText);
      if (!cursor) cursor = el('span', { class: 'cursor-blink' });
      content.append(cursor);
      renderIcons(content);
      scrollToBottom();
    },
  };
}

function toggleSendUI(streaming) {
  $('#btn-send').hidden = streaming;
  $('#btn-stop').hidden = !streaming;
  $('#input').disabled = false;
}

function scrollToBottom() {
  const thread = $('#thread');
  requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
}

/** Javob tayyor bo'lganda qisqa signal (profil sozlamasi yoqilgan bo'lsa). */
function notifyDone() {
  const { user } = getState();
  if (!user?.notifications || document.hasFocus()) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    setTimeout(() => ctx.close(), 600);
  } catch { /* audio yo'q */ }
}

export { escapeHtml };
