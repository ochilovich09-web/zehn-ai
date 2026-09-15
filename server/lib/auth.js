import { config } from '../config.js';
import { Users, Sessions } from './db.js';
import { signJwt, verifyJwt, randomToken, sha256 } from './crypto.js';
import { unauthorized } from './http.js';

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

/** Middleware: himoyalangan endpointlar uchun. */
export async function requireAuth(ctx) {
  const header = ctx.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) throw unauthorized('Token yuborilmadi');

  const payload = verifyJwt(token);
  if (!payload) throw unauthorized('Token yaroqsiz yoki muddati tugagan');

  const user = await Users.byId(payload.sub);
  if (!user) throw unauthorized('Foydalanuvchi topilmadi');

  ctx.user = user;
}
