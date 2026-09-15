import fs from 'node:fs';
import path from 'node:path';
import { Router } from '../lib/router.js';
import { ok, readJson, badRequest, unauthorized } from '../lib/http.js';
import { Users, Sessions, Chats, Messages, Files, Audit } from '../lib/db.js';
import { requireAuth, clearRefreshCookie } from '../lib/auth.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { v } from '../lib/validate.js';
import { config } from '../config.js';
import { getQuota } from '../services/quota.js';

export const userRoutes = new Router('/api/user');

const THEMES = ['light', 'dark', 'system'];
const MAX_AVATAR = 200 * 1024;   // base64 avatar uchun chegara

/* ── Profilni yangilash ─────────────────────────────────────────────── */
userRoutes.patch('/profile', requireAuth, async (ctx) => {
  const body = await readJson(ctx.req, 1024 * 1024);
  const patch = {};

  if (body.fullName !== undefined) patch.full_name = v.string(body.fullName, 'fullName', { min: 2, max: 80 });
  if (body.language !== undefined) patch.language = v.oneOf(body.language, config.languages, 'language');
  if (body.theme !== undefined) patch.theme = v.oneOf(body.theme, THEMES, 'theme');
  if (body.notifications !== undefined) patch.notifications = v.bool(body.notifications) ? 1 : 0;

  if (body.avatar !== undefined) {
    if (body.avatar === null || body.avatar === '') patch.avatar = null;
    else {
      const avatar = String(body.avatar);
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(avatar)) throw badRequest('Avatar formati noto‘g‘ri (PNG/JPEG/WEBP kutilgan)');
      if (avatar.length > MAX_AVATAR) throw badRequest('Avatar hajmi juda katta (maks. 150 KB)');
      patch.avatar = avatar;
    }
  }

  const user = await Users.update(ctx.user.id, patch);
  ok(ctx.res, { user: Users.publik(user) });
});

/* ── Parolni almashtirish ───────────────────────────────────────────── */
userRoutes.post('/change-password', requireAuth, async (ctx) => {
  const body = await readJson(ctx.req);
  const current = v.string(body.currentPassword, 'currentPassword', { min: 1, max: 200, trim: false });
  const next = v.password(body.newPassword, 'newPassword');

  if (!verifyPassword(current, ctx.user.password_hash)) throw unauthorized('Joriy parol noto‘g‘ri');
  if (current === next) throw badRequest('Yangi parol eskisidan farq qilishi kerak');

  await Users.update(ctx.user.id, { password_hash: hashPassword(next) });
  await Sessions.revokeAll(ctx.user.id);
  clearRefreshCookie(ctx.res);
  await Audit.add(ctx.user.id, 'password_changed', '', ctx.ip);

  ok(ctx.res, { message: 'Parol yangilandi. Xavfsizlik uchun barcha qurilmalardan chiqarildingiz.' });
});

/* ── Ma'lumotlarni eksport qilish (GDPR uslubida) ───────────────────── */
userRoutes.get('/export', requireAuth, async (ctx) => {
  const chats = [
    ...(await Chats.list(ctx.user.id, { archived: 0 })),
    ...(await Chats.list(ctx.user.id, { archived: 1 })),
  ];

  const exportedChats = [];
  const files = [];
  for (const c of chats) {
    const messages = await Messages.list(c.id);
    exportedChats.push({
      ...Chats.publik(c),
      messages: messages.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
    });
    files.push(...(await Files.listForChat(ctx.user.id, c.id)));
  }

  const data = {
    exportedAt: new Date().toISOString(),
    user: Users.publik(ctx.user),
    chats: exportedChats,
    files,
    activity: await Audit.recent(ctx.user.id, 50),
  };

  const json = JSON.stringify(data, null, 2);
  ctx.res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="zehn-ai-export-${Date.now()}.json"`,
  });
  ctx.res.end(json);
});

/* ── Akkauntni o'chirish ────────────────────────────────────────────── */
userRoutes.post('/delete-account', requireAuth, async (ctx) => {
  const body = await readJson(ctx.req);
  const password = v.string(body.password, 'password', { min: 1, max: 200, trim: false });
  if (!verifyPassword(password, ctx.user.password_hash)) throw unauthorized('Parol noto‘g‘ri');

  // Diskdagi barcha fayllarni tozalaymiz (suhbatga biriktirilmaganlari ham)
  for (const f of await Files.rawForUser(ctx.user.id)) {
    const full = path.join(config.uploads.dir, path.basename(f.storage_key));
    try { if (full.startsWith(config.uploads.dir) && fs.existsSync(full)) fs.unlinkSync(full); } catch { /* e'tiborsiz */ }
  }

  await Audit.add(ctx.user.id, 'account_deleted', ctx.user.email, ctx.ip);
  // Sessiyalar, suhbatlar, xabarlar, fayl yozuvlari va foydalanuvchi — bitta tranzaksiyada
  await Users.remove(ctx.user.id);
  clearRefreshCookie(ctx.res);
  ok(ctx.res, { message: 'Akkaunt o‘chirildi' });
});

/* ── Joriy tarif va limit ───────────────────────────────────────────── */
userRoutes.get('/usage', requireAuth, async (ctx) => {
  ok(ctx.res, { quota: await getQuota(ctx.user) });
});

/* ── Faoliyat tarixi ────────────────────────────────────────────────── */
userRoutes.get('/activity', requireAuth, async (ctx) => {
  ok(ctx.res, { activity: await Audit.recent(ctx.user.id, 30) });
});
