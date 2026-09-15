import { config } from '../config.js';
import { tooMany } from './http.js';

/** Sliding-window rate limiter (xotirada; bitta instans uchun yetarli). */
const buckets = new Map();

setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [key, hits] of buckets) {
    const alive = hits.filter((t) => t > cutoff);
    if (alive.length) buckets.set(key, alive); else buckets.delete(key);
  }
}, 60_000).unref?.();

function ruleFor(pathname) {
  for (const [prefix, rule] of Object.entries(config.limits)) {
    if (prefix !== 'default' && pathname.startsWith(prefix)) return rule;
  }
  return config.limits.default;
}

export function rateLimit(ctx) {
  const [max, windowMs] = ruleFor(ctx.pathname);
  const key = `${ctx.ip}|${ruleFor(ctx.pathname) === config.limits.default ? 'default' : ctx.pathname.split('/').slice(0, 3).join('/')}`;
  const nowT = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => t > nowT - windowMs);
  hits.push(nowT);
  buckets.set(key, hits);
  if (hits.length > max) {
    const retry = Math.ceil((hits[0] + windowMs - nowT) / 1000);
    ctx.res.setHeader('Retry-After', String(Math.max(retry, 1)));
    throw tooMany();
  }
  ctx.res.setHeader('X-RateLimit-Limit', String(max));
  ctx.res.setHeader('X-RateLimit-Remaining', String(Math.max(max - hits.length, 0)));
}

/** Login urinishlarini alohida cheklash (brute-force'ga qarshi). */
const loginAttempts = new Map();
export const loginGuard = {
  check(emailOrIp) {
    const rec = loginAttempts.get(emailOrIp);
    if (!rec) return;
    if (rec.blockedUntil && rec.blockedUntil > Date.now()) {
      const sec = Math.ceil((rec.blockedUntil - Date.now()) / 1000);
      throw tooMany(`Juda ko‘p muvaffaqiyatsiz urinish. ${sec} soniyadan keyin qayta urinib ko‘ring.`);
    }
  },
  fail(emailOrIp) {
    const rec = loginAttempts.get(emailOrIp) || { count: 0, blockedUntil: 0 };
    rec.count += 1;
    if (rec.count >= 5) {
      rec.blockedUntil = Date.now() + Math.min(2 ** (rec.count - 5), 30) * 60_000;
    }
    loginAttempts.set(emailOrIp, rec);
  },
  reset(emailOrIp) { loginAttempts.delete(emailOrIp); },
};
