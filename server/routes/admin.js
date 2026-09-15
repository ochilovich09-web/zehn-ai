/**
 * Admin API: foydalanuvchilar, foydalanish statistikasi, bloklash va tarifni o'zgartirish.
 * Kirish: ADMIN_EMAILS dagi hisoblar.
 */
import { Router } from '../lib/router.js';
import { ok, readJson, badRequest, notFound, forbidden } from '../lib/http.js';
import { Users, Sessions, Usage, Admin, Audit } from '../lib/db.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import { v } from '../lib/validate.js';
import { config } from '../config.js';
import { getQuota, TIER_NAMES } from '../services/quota.js';

export const adminRoutes = new Router('/api/admin');

const STATUSES = ['active', 'blocked'];
const SORTS = ['last_seen', 'newest', 'requests', 'tokens'];

/* ── Umumiy ko'rsatkichlar ── */
adminRoutes.get('/stats', requireAuth, requireAdmin, async (ctx) => {
  ok(ctx.res, {
    stats: await Admin.stats(),
    tiers: Object.fromEntries(TIER_NAMES.map((name) => [name, config.tiers[name].dailyRequests])),
  });
});

/* ── Foydalanuvchilar ro'yxati ── */
adminRoutes.get('/users', requireAuth, requireAdmin, async (ctx) => {
  const q = ctx.query;
  const result = await Admin.listUsers({
    search: String(q.q || '').trim().slice(0, 100),
    status: STATUSES.includes(q.status) ? q.status : '',
    tier: TIER_NAMES.includes(q.tier) ? q.tier : '',
    sort: SORTS.includes(q.sort) ? q.sort : 'last_seen',
    limit: Number.parseInt(q.limit, 10) || 50,
    offset: Number.parseInt(q.offset, 10) || 0,
  });
  ok(ctx.res, result);
});

/* ── Bitta foydalanuvchi tafsilotlari ── */
adminRoutes.get('/users/:id', requireAuth, requireAdmin, async (ctx) => {
  const user = await Users.byId(v.id(ctx.params.id));
  if (!user) throw notFound('Foydalanuvchi topilmadi');

  const [daily, activity, sessions, quota, row] = await Promise.all([
    Usage.daily(user.id, 14),
    Audit.recent(user.id, 15),
    Sessions.listFor(user.id),
    getQuota(user),
    Admin.getUser(user.id),
  ]);

  ok(ctx.res, {
    user: row,
    quota,
    daily,
    activity,
    sessions: sessions.length,
  });
});

/* ── Bloklash / blokdan chiqarish / tarifni o'zgartirish ── */
adminRoutes.patch('/users/:id', requireAuth, requireAdmin, async (ctx) => {
  const target = await Users.byId(v.id(ctx.params.id));
  if (!target) throw notFound('Foydalanuvchi topilmadi');

  const body = await readJson(ctx.req);
  const patch = {};
  const changes = [];

  if (body.status !== undefined) {
    const status = v.oneOf(body.status, STATUSES, 'status');
    if (status === 'blocked') {
      if (target.id === ctx.user.id) throw badRequest('O‘zingizni bloklay olmaysiz');
      if (target.role === 'admin') throw forbidden('Administratorni bloklab bo‘lmaydi — avval ADMIN_EMAILS dan chiqaring');
      patch.status = 'blocked';
      patch.blocked_at = Date.now();
      patch.block_reason = body.reason ? v.string(body.reason, 'reason', { min: 1, max: 300 }) : null;
    } else {
      patch.status = 'active';
      patch.blocked_at = null;
      patch.block_reason = null;
    }
    if (patch.status !== target.status) changes.push(`status: ${target.status} -> ${patch.status}`);
  }

  if (body.tier !== undefined) {
    patch.tier = v.oneOf(body.tier, TIER_NAMES, 'tier');
    if (patch.tier !== target.tier) changes.push(`tier: ${target.tier} -> ${patch.tier}`);
  }

  if (!Object.keys(patch).length) throw badRequest('O‘zgartirish uchun status yoki tier yuboring');

  const updated = await Users.update(target.id, patch);

  // Bloklanganda barcha qurilmalardan chiqaramiz (access token esa keyingi so'rovdayoq rad etiladi)
  if (patch.status === 'blocked') await Sessions.revokeAll(target.id);

  if (changes.length) {
    const detail = `${changes.join(', ')}${patch.block_reason ? ` (${patch.block_reason})` : ''} — admin: ${ctx.user.email}`;
    await Audit.add(target.id, 'admin_update', detail, ctx.ip);
    await Audit.add(ctx.user.id, 'admin_action', `${target.email}: ${changes.join(', ')}`, ctx.ip);
  }

  ok(ctx.res, { user: await Admin.getUser(updated.id) });
});

/* ── Barcha sessiyalarni bekor qilish ── */
adminRoutes.post('/users/:id/revoke-sessions', requireAuth, requireAdmin, async (ctx) => {
  const target = await Users.byId(v.id(ctx.params.id));
  if (!target) throw notFound('Foydalanuvchi topilmadi');
  await Sessions.revokeAll(target.id);
  await Audit.add(target.id, 'admin_sessions_revoked', `admin: ${ctx.user.email}`, ctx.ip);
  ok(ctx.res, {});
});
