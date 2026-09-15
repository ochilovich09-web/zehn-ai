import crypto from 'node:crypto';
import { config } from '../config.js';

/* ── ID ─────────────────────────────────────────────────────────────── */
export const uid = (prefix = '') =>
  (prefix ? prefix + '_' : '') + crypto.randomBytes(12).toString('base64url');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/* ── Parol: scrypt + tasodifiy tuz ──────────────────────────────────── */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password.normalize('NFKC'), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, keyB64] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: +N, r: +r, p: +p,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

/* ── JWT (HS256, o'z implementatsiyamiz) ────────────────────────────── */
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');

export function signJwt(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds, jti: uid() }));
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

export function verifyJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const expected = sign(`${h}.${b}`);
  if (s.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
