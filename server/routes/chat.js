import fs from 'node:fs';
import path from 'node:path';
import { Router } from '../lib/router.js';
import { ok, readJson, notFound, badRequest, sse } from '../lib/http.js';
import { Chats, Messages, Files, Audit } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { v, sanitizeText } from '../lib/validate.js';
import { config } from '../config.js';
import { runPipeline, makeTitle } from '../services/ai/engine.js';
import { detectPromptInjection } from '../services/security/scan.js';
import { assertQuota, recordUsage } from '../services/quota.js';
import { log } from '../lib/logger.js';

export const chatRoutes = new Router('/api/chat');

const MAX_MESSAGE = 20000;
const HISTORY_TURNS = 16;

/* ── Suhbatlar ro'yxati ─────────────────────────────────────────────── */
chatRoutes.get('/chats', requireAuth, async (ctx) => {
  const archived = ctx.query.archived === '1' ? 1 : 0;
  const search = (ctx.query.q || '').slice(0, 100);
  const chats = (await Chats.list(ctx.user.id, { archived, search })).map(Chats.publik);
  ok(ctx.res, { chats });
});

chatRoutes.post('/chats', requireAuth, async (ctx) => {
  const body = await readJson(ctx.req).catch(() => ({}));
  const title = body.title ? v.string(body.title, 'title', { max: 120 }) : 'Yangi suhbat';
  const chat = await Chats.create(ctx.user.id, title);
  ok(ctx.res, { chat: Chats.publik(chat) }, 201);
});

chatRoutes.get('/chats/:id', requireAuth, async (ctx) => {
  const chat = await Chats.byId(ctx.params.id, ctx.user.id);
  if (!chat) throw notFound('Suhbat topilmadi');
  ok(ctx.res, {
    chat: Chats.publik(chat),
    messages: await Messages.list(chat.id),
    files: await Files.listForChat(ctx.user.id, chat.id),
  });
});

chatRoutes.patch('/chats/:id', requireAuth, async (ctx) => {
  const body = await readJson(ctx.req);
  const patch = {};
  if (body.title !== undefined) patch.title = v.string(body.title, 'title', { min: 1, max: 120 });
  if (body.archived !== undefined) patch.archived = v.bool(body.archived) ? 1 : 0;
  if (body.pinned !== undefined) patch.pinned = v.bool(body.pinned) ? 1 : 0;

  const chat = await Chats.update(ctx.params.id, ctx.user.id, patch);
  if (!chat) throw notFound('Suhbat topilmadi');
  ok(ctx.res, { chat: Chats.publik(chat) });
});

chatRoutes.delete('/chats/:id', requireAuth, async (ctx) => {
  const files = await Files.rawForChat(ctx.user.id, ctx.params.id);
  const removed = await Chats.remove(ctx.params.id, ctx.user.id);
  if (!removed) throw notFound('Suhbat topilmadi');

  // Baza yozuvi o'chirilgach, fayllarni diskdan ham tozalaymiz
  for (const f of files) {
    removeStoredFile(f.storage_key);
    await Files.remove(f.id, ctx.user.id);
  }
  await Audit.add(ctx.user.id, 'chat_deleted', ctx.params.id, ctx.ip);
  ok(ctx.res, {});
});

chatRoutes.delete('/messages/:id', requireAuth, async (ctx) => {
  const msg = await Messages.byId(ctx.params.id);
  if (!msg) throw notFound('Xabar topilmadi');
  const chat = await Chats.byId(msg.chatId, ctx.user.id);
  if (!chat) throw notFound('Xabar topilmadi');
  await Messages.remove(msg.id);
  ok(ctx.res, {});
});

/* ── Statistika (profil sahifasi uchun) ─────────────────────────────── */
chatRoutes.get('/stats', requireAuth, async (ctx) => {
  ok(ctx.res, {
    stats: {
      chats: await Chats.count(ctx.user.id),
      messages: await Messages.countFor(ctx.user.id),
      files: await Files.countFor(ctx.user.id),
      aiMode: config.ai.enabled ? config.ai.provider : 'local',
      model: config.ai.enabled ? config.ai.model : 'zehn-local-reasoner',
    },
  });
});

/* ── Xabar yuborish (SSE oqimi) ─────────────────────────────────────── */
chatRoutes.post('/chats/:id/messages', requireAuth, async (ctx) => {
  const chat = await Chats.byId(ctx.params.id, ctx.user.id);
  if (!chat) throw notFound('Suhbat topilmadi');

  const body = await readJson(ctx.req, 2 * 1024 * 1024);
  const rawContent = v.string(body.content ?? '', 'content', { min: 1, max: MAX_MESSAGE });
  const content = sanitizeText(rawContent);
  const fileIds = Array.isArray(body.fileIds) ? body.fileIds.slice(0, config.uploads.maxPerMessage) : [];

  // Limit xabar saqlanishidan va SSE ochilishidan oldin tekshiriladi — klient oddiy JSON xato oladi
  await assertQuota(ctx.user);

  // Biriktirilgan fayllarni yuklaymiz (faqat shu foydalanuvchiniki)
  const attachments = [];
  for (const id of fileIds) {
    const raw = await Files.raw(v.id(id, 'fileId'), ctx.user.id);
    if (!raw) throw badRequest('Biriktirilgan fayl topilmadi');
    if (raw.scan_status === 'blocked') throw badRequest(`"${raw.name}" fayli xavfsizlik tekshiruvidan o‘tmagan`);
    attachments.push({
      id: raw.id, name: raw.name, kind: raw.kind, size: raw.size,
      text: raw.extract || '', mime: raw.mime,
    });
  }

  const history = await Messages.history(chat.id, HISTORY_TURNS);
  const isFirstMessage = history.length === 0;

  const userMessage = await Messages.add({
    chatId: chat.id, userId: ctx.user.id, role: 'user', content,
    meta: attachments.length ? { attachments: attachments.map((a) => ({ id: a.id, name: a.name, kind: a.kind, size: a.size })) } : null,
  });
  for (const a of attachments) await Files.attach(a.id, chat.id, userMessage.id);

  /* SSE kanalini ochamiz */
  const stream = sse(ctx.res);
  const controller = new AbortController();
  ctx.req.on('close', () => controller.abort());

  stream.send('user_message', { message: userMessage });

  // Fayl ichidagi "AI ko'rsatmalari" haqida ogohlantirish
  for (const a of attachments) {
    const inj = detectPromptInjection(a.text || '');
    if (inj.detected) stream.send('warning', { file: a.name, note: inj.note });
  }

  let result;
  try {
    result = await runPipeline({
      question: content,
      history,
      attachments,
      user: ctx.user,
      signal: controller.signal,
      send: (event, data) => stream.send(event, data),
    });
  } catch (err) {
    log.error('Pipeline xatosi:', err);
    stream.send('error', { message: 'Javob tayyorlashda xatolik yuz berdi' });
    stream.end();
    return;
  }

  // Provayder tokenlari sarflangan — klient uzilgan bo'lsa ham hisobga olinadi
  await recordUsage({ user: ctx.user, chatId: chat.id, kind: 'message', meta: result.meta })
    .catch((err) => log.warn('Usage yozilmadi:', err.message));

  if (controller.signal.aborted && !result.text.trim()) {
    stream.end();
    return;
  }

  const aiMessage = await Messages.add({
    chatId: chat.id, userId: ctx.user.id, role: 'assistant',
    content: result.text, meta: result.meta,
  });

  // Birinchi xabardan keyin suhbatga sarlavha qo'yamiz
  if (isFirstMessage) {
    const title = await makeTitle(content, result.analysis.language);
    await Chats.update(chat.id, ctx.user.id, { title, domain: result.analysis.domain });
    stream.send('title', { chatId: chat.id, title, domain: result.analysis.domain });
  }

  stream.send('done', { message: aiMessage, meta: result.meta });
  stream.end();
});

/* ── Xabarni qayta generatsiya qilish ───────────────────────────────── */
chatRoutes.post('/chats/:id/regenerate', requireAuth, async (ctx) => {
  const chat = await Chats.byId(ctx.params.id, ctx.user.id);
  if (!chat) throw notFound('Suhbat topilmadi');

  const all = await Messages.list(chat.id);
  const lastUser = [...all].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw badRequest('Qayta generatsiya uchun savol topilmadi');

  await assertQuota(ctx.user);

  // Oxirgi AI javobini olib tashlaymiz
  const lastAi = [...all].reverse().find((m) => m.role === 'assistant');
  if (lastAi && lastAi.createdAt > lastUser.createdAt) await Messages.remove(lastAi.id);

  const history = (await Messages.list(chat.id))
    .filter((m) => m.createdAt < lastUser.createdAt)
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content }));

  const attachments = [];
  for (const a of lastUser.meta?.attachments || []) {
    const raw = await Files.raw(a.id, ctx.user.id);
    if (raw) attachments.push({ id: raw.id, name: raw.name, kind: raw.kind, size: raw.size, text: raw.extract || '' });
  }

  const stream = sse(ctx.res);
  const controller = new AbortController();
  ctx.req.on('close', () => controller.abort());

  const result = await runPipeline({
    question: lastUser.content,
    history,
    attachments,
    user: ctx.user,
    signal: controller.signal,
    send: (event, data) => stream.send(event, data),
  });

  await recordUsage({ user: ctx.user, chatId: chat.id, kind: 'regenerate', meta: result.meta })
    .catch((err) => log.warn('Usage yozilmadi:', err.message));

  const aiMessage = await Messages.add({
    chatId: chat.id, userId: ctx.user.id, role: 'assistant',
    content: result.text, meta: { ...result.meta, regenerated: true },
  });
  stream.send('done', { message: aiMessage, meta: result.meta });
  stream.end();
});

function removeStoredFile(storageKey) {
  try {
    const full = path.join(config.uploads.dir, path.basename(storageKey));
    if (full.startsWith(config.uploads.dir) && fs.existsSync(full)) fs.unlinkSync(full);
  } catch (err) {
    log.warn('Faylni o‘chirib bo‘lmadi:', err.message);
  }
}
