import { config } from '../config.js';
import { Users, Sessions } from './db.js';
import { signJwt, verifyJwt, randomToken, sha256 } from './crypto.js';
import { unauthorized, forbidden, HttpError } from './http.js';

export const REFRESH_COOKIE = 'zehn_refresh';

export function parseCookies(header = '') {
  const out = Object.create(null);
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setRefreshCookie(res, token) {
  const attrs = [
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/api/auth',
    'SameSite=Strict',
    `Max-Age=${config.refreshTtl}`,
  ];
  if (config.isProd) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearRefreshCookie(res) {
  res.setHeader('Set-Cookie', `${REFRESH_COOKIE}=; HttpOnly; Path=/api/auth; SameSite=Strict; Max-Age=0`);
}

/** Access (JWT) + refresh (opaque, DB'da hash ko‘rinishida) juftligini beradi. */
export async function issueTokens(user, ctx) {
  const accessToken = signJwt({ sub: user.id, email: user.email }, config.accessTtl);
  const refreshToken = randomToken(48);
  const sessionId = await Sessions.create({
    userId: user.id,
    refreshHash: sha256(refreshToken),
    userAgent: (ctx.headers['user-agent'] || '').slice(0, 200),
    ip: ctx.ip,
    ttlSeconds: config.refreshTtl,
  });
  return { accessToken, refreshToken, sessionId, expiresIn: config.accessTtl };
}

/** Bloklangan foydalanuvchi uchun xato (frontend shu kod bo'yicha maxsus ekran ko'rsatadi). */
export const blockedError = (user) => new HttpError(
  403,
  'ACCOUNT_BLOCKED',
  'Hisobingiz administrator tomonidan bloklangan',
  user.block_reason ? { reason: user.block_reason } : null
);

/* Oxirgi faollikni har so'rovda emas, daqiqasiga ko'pi bilan bir marta yozamiz (Turso'ga ortiqcha yuk bermaslik uchun) */
const SEEN_INTERVAL = 60 * 1000;
const lastSeenWrite = new Map();

function markSeen(user) {
  const t = Date.now();
  const previous = Math.max(lastSeenWrite.get(user.id) || 0, user.last_seen_at || 0);
  if (t - previous < SEEN_INTERVAL) return;
  lastSeenWrite.set(user.id, t);
  Users.touchSeen(user.id).catch(() => { /* faollik vaqti muhim emas */ });
}

/** Middleware: himoyalangan endpointlar uchun. */
export async function requireAuth(ctx) {
  const header = ctx.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) throw unauthorized('Token yuborilmadi');

  const payload = verifyJwt(token);
  if (!payload) throw unauthorized('Token yaroqsiz yoki muddati tugagan');

  const user = await Users.byId(payload.sub);
  if (!user) throw unauthorized('Foydalanuvchi topilmadi');

  // Status har so'rovda bazadan tekshiriladi — bloklash access token muddatini kutmasdan darhol ishlaydi
  if (user.status === 'blocked') throw blockedError(user);

  ctx.user = user;
  markSeen(user);
}

/** Middleware: faqat adminlar uchun (requireAuth'dan keyin qo'yiladi). */
export function requireAdmin(ctx) {
  if (ctx.user?.role !== 'admin') throw forbidden('Bu bo‘lim faqat administratorlar uchun');
}
