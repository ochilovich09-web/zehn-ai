import fs from 'node:fs';
import path from 'node:path';
import { Router } from '../lib/router.js';
import { ok, readBody, badRequest, notFound, tooLarge } from '../lib/http.js';
import { Files, Audit } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { parseMultipart, sniffMime } from '../lib/multipart.js';
import { safeFileName } from '../lib/validate.js';
import { uid } from '../lib/crypto.js';
import { config } from '../config.js';
import { scanFile, detectPromptInjection } from '../services/security/scan.js';
import { extractText, summarize } from '../services/extract/index.js';
import { log } from '../lib/logger.js';

export const fileRoutes = new Router('/api/files');

/* ── Yuklash ────────────────────────────────────────────────────────── */
fileRoutes.post('/upload', requireAuth, async (ctx) => {
  const contentType = ctx.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) throw badRequest('multipart/form-data kutilgan');

  const limit = config.uploads.maxSize * config.uploads.maxPerMessage + 1024 * 1024;
  const buf = await readBody(ctx.req, limit);
  const { files } = parseMultipart(buf, contentType, {
    maxSize: config.uploads.maxSize,
    maxFiles: config.uploads.maxPerMessage,
  });

  if (!files.length) throw badRequest('Fayl yuborilmadi');

  const saved = [];
  for (const f of files) {
    saved.push(await handleOne(f, ctx));
  }
  ok(ctx.res, { files: saved }, 201);
});

async function handleOne(file, ctx) {
  const name = safeFileName(file.filename);

  if (file.data.length === 0) throw badRequest(`"${name}" bo‘sh fayl`);
  if (file.data.length > config.uploads.maxSize) {
    throw tooLarge(`"${name}" hajmi ${(config.uploads.maxSize / 1048576).toFixed(0)} MB dan katta`);
  }

  // 1) Haqiqiy turni imzo bo'yicha aniqlaymiz (kengaytmaga ishonmaymiz)
  const realMime = sniffMime(file.data, file.mime);
  const allowed = config.uploads.allowed.get(realMime) || config.uploads.allowed.get(file.mime);
  if (!allowed) {
    throw badRequest(`"${name}" turi qo‘llab-quvvatlanmaydi (${realMime}). Ruxsat etilgan: PDF, DOCX, DOC, TXT, CSV, JSON, XLSX, XLS, rasm.`);
  }

  // 2) Xavfsizlik tekshiruvi
  const scan = scanFile(file.data, name, realMime);
  if (scan.status === 'blocked') {
    await Audit.add(ctx.user.id, 'file_blocked', `${name}: ${scan.notes.join('; ')}`, ctx.ip);
    throw badRequest(`"${name}" xavfsizlik tekshiruvidan o‘tmadi: ${scan.notes.join('; ')}`);
  }

  // 3) Matn ajratish
  const extracted = extractText(file.data, realMime, name);
  const injection = detectPromptInjection(extracted.text);
  const notes = [...scan.notes];
  if (extracted.note) notes.push(extracted.note);
  if (injection.detected) notes.push(injection.note);

  // 4) Diskka saqlash (nomi tasodifiy — asl nom faqat bazada)
  const storageKey = `${uid('f')}_${scan.sha256.slice(0, 8)}.${allowed.ext}`;
  const target = path.join(config.uploads.dir, storageKey);
  fs.writeFileSync(target, file.data, { mode: 0o600 });

  const record = await Files.create({
    userId: ctx.user.id,
    name,
    mime: realMime,
    kind: allowed.kind,
    size: file.data.length,
    storageKey,
    textLen: extracted.text.length,
    extract: extracted.text || null,
    summary: summarize(extracted.text, allowed.kind),
    scanStatus: injection.detected || scan.status === 'suspicious' ? 'suspicious' : 'clean',
    scanNote: notes.join(' • ') || null,
  });

  await Audit.add(ctx.user.id, 'file_uploaded', `${name} (${allowed.kind}, ${file.data.length}b)`, ctx.ip);
  log.info(`Fayl qabul qilindi: ${name} -> ${storageKey} [${extracted.text.length} belgi matn]`);
  return record;
}

/* ── Ma'lumot va yuklab olish ───────────────────────────────────────── */
fileRoutes.get('/:id', requireAuth, async (ctx) => {
  const file = await Files.byId(ctx.params.id, ctx.user.id);
  if (!file) throw notFound('Fayl topilmadi');
  ok(ctx.res, { file });
});

fileRoutes.get('/:id/text', requireAuth, async (ctx) => {
  const raw = await Files.raw(ctx.params.id, ctx.user.id);
  if (!raw) throw notFound('Fayl topilmadi');
  ok(ctx.res, { name: raw.name, text: raw.extract || '', length: raw.text_len });
});

fileRoutes.get('/:id/download', requireAuth, async (ctx) => {
  const raw = await Files.raw(ctx.params.id, ctx.user.id);
  if (!raw) throw notFound('Fayl topilmadi');

  const full = path.join(config.uploads.dir, path.basename(raw.storage_key));
  if (!full.startsWith(config.uploads.dir) || !fs.existsSync(full)) throw notFound('Fayl diskda topilmadi');

  ctx.res.writeHead(200, {
    'Content-Type': raw.mime,
    'Content-Length': raw.size,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(raw.name)}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  fs.createReadStream(full).pipe(ctx.res);
});

fileRoutes.delete('/:id', requireAuth, async (ctx) => {
  const raw = await Files.raw(ctx.params.id, ctx.user.id);
  if (!raw) throw notFound('Fayl topilmadi');
  const full = path.join(config.uploads.dir, path.basename(raw.storage_key));
  try { if (full.startsWith(config.uploads.dir) && fs.existsSync(full)) fs.unlinkSync(full); }
  catch (err) { log.warn('Faylni o‘chirishda xato:', err.message); }
  await Files.remove(raw.id, ctx.user.id);
  ok(ctx.res, {});
});
