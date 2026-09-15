import { Router } from '../lib/router.js';
import { ok, readJson, conflict, unauthorized, badRequest, notFound } from '../lib/http.js';
import { Users, Sessions, Audit } from '../lib/db.js';
import { hashPassword, verifyPassword, randomToken, sha256, signJwt } from '../lib/crypto.js';
import { issueTokens, requireAuth, blockedError, parseCookies, setRefreshCookie, clearRefreshCookie, REFRESH_COOKIE } from '../lib/auth.js';
import { loginGuard } from '../lib/ratelimit.js';
import { v } from '../lib/validate.js';
import { config } from '../config.js';
import { sendMail } from '../services/mailer.js';

export const authRoutes = new Router('/api/auth');

const VERIFY_TTL = 24 * 60 * 60 * 1000;
const RESET_TTL = 60 * 60 * 1000;
const origin = (ctx) => {
  const host = ctx.headers.host || `${config.host}:${config.port}`;
  const proto = ctx.headers['x-forwarded-proto'] || (config.isProd ? 'https' : 'http');
  return `${proto}://${host}`;
};

/* ── Ro'yxatdan o'tish ──────────────────────────────────────────────── */
authRoutes.post('/register', async (ctx) => {
  const body = await readJson(ctx.req);
  const fullName = v.string(body.fullName, 'fullName', { min: 2, max: 80 });
  const email = v.email(body.email);
  const password = v.password(body.password);
  const language = config.languages.includes(body.language) ? body.language : config.defaultLanguage;

  if (body.confirmPassword !== undefined && body.confirmPassword !== body.password) {
    throw badRequest('Parollar mos kelmadi');
  }
  if (await Users.byEmail(email)) throw conflict('Bu email allaqachon ro‘yxatdan o‘tgan');

  const verifyToken = randomToken(24);
  const user = await Users.create({ fullName, email, passwordHash: hashPassword(password), language, verifyToken });

  const link = `${origin(ctx)}/#/verify?token=${verifyToken}`;
  const mail = await sendMail('verify', { to: email, link, language });

  const tokens = await issueTokens(user, ctx);
  setRefreshCookie(ctx.res, tokens.refreshToken);
  await Audit.add(user.id, 'register', email, ctx.ip);

  ok(ctx.res, {
    user: Users.publik(user),
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
    // Dev qulayligi uchun: SMTP yo'q bo'lganda havolani qaytaramiz
    ...(config.exposeDevLinks ? { devVerifyLink: link, mailTransport: mail.transport } : {}),
  }, 201);
});

/* ── Kirish ─────────────────────────────────────────────────────────── */
authRoutes.post('/login', async (ctx) => {
  const body = await readJson(ctx.req);
  const email = v.email(body.email);
  const password = v.string(body.password, 'password', { min: 1, max: 200, trim: false });

  loginGuard.check(email);
  const user = await Users.byEmail(email);

  // Vaqt bo'yicha hujumni kamaytirish uchun foydalanuvchi topilmasa ham hisoblaymiz
  const valid = user ? verifyPassword(password, user.password_hash) : verifyPassword(password, hashPassword('dummy'));
  if (!user || !valid) {
    loginGuard.fail(email);
    await Audit.add(user?.id ?? null, 'login_failed', email, ctx.ip);
    throw unauthorized('Email yoki parol noto‘g‘ri');
  }

  loginGuard.reset(email);
  // Bloklash holati parol to'g'ri bo'lgandagina oshkor qilinadi
  if (user.status === 'blocked') {
    await Audit.add(user.id, 'login_blocked', '', ctx.ip);
    throw blockedError(user);
  }
  const tokens = await issueTokens(user, ctx);
  setRefreshCookie(ctx.res, tokens.refreshToken);
  await Audit.add(user.id, 'login', '', ctx.ip);

  ok(ctx.res, { user: Users.publik(user), accessToken: tokens.accessToken, expiresIn: tokens.expiresIn });
});

/* ── Access tokenni yangilash ───────────────────────────────────────── */
authRoutes.post('/refresh', async (ctx) => {
  const cookies = parseCookies(ctx.headers.cookie);
  const token = cookies[REFRESH_COOKIE];
  if (!token) throw unauthorized('Refresh token yo‘q');

  const session = await Sessions.byHash(sha256(token));
  if (!session || session.expires_at < Date.now()) {
    clearRefreshCookie(ctx.res);
    throw unauthorized('Sessiya muddati tugagan, qaytadan kiring');
  }

  const user = await Users.byId(session.user_id);
  if (!user) throw unauthorized('Foydalanuvchi topilmadi');
  if (user.status === 'blocked') {
    await Sessions.revoke(session.id, user.id);
    clearRefreshCookie(ctx.res);
    throw blockedError(user);
  }

  // Refresh token rotatsiyasi — o'g'irlangan token qayta ishlatilmasin
  const fresh = randomToken(48);
  await Sessions.rotate(session.id, sha256(fresh), config.refreshTtl);
  setRefreshCookie(ctx.res, fresh);

  // Sessiya allaqachon mavjud — faqat yangi access token kerak
  ok(ctx.res, {
    user: Users.publik(user),
    accessToken: signJwt({ sub: user.id, email: user.email }, config.accessTtl),
    expiresIn: config.accessTtl,
  });
});

/* ── Chiqish ────────────────────────────────────────────────────────── */
authRoutes.post('/logout', async (ctx) => {
  const cookies = parseCookies(ctx.headers.cookie);
  const token = cookies[REFRESH_COOKIE];
  if (token) {
    const session = await Sessions.byHash(sha256(token));
    if (session) await Sessions.revoke(session.id, session.user_id);
  }
  clearRefreshCookie(ctx.res);
  ok(ctx.res, {});
});

/* ── Email tasdiqlash ───────────────────────────────────────────────── */
authRoutes.post('/verify-email', async (ctx) => {
  const { token } = await readJson(ctx.req);
  const user = token ? await Users.byVerifyToken(String(token)) : null;
  if (!user) throw badRequest('Tasdiqlash havolasi yaroqsiz yoki allaqachon ishlatilgan');
  if (Date.now() - user.created_at > VERIFY_TTL && !user.email_verified) {
    // Muddati o'tgan bo'lsa — yangi havola beramiz
    const fresh = randomToken(24);
    await Users.update(user.id, { verify_token: fresh });
    const link = `${origin(ctx)}/#/verify?token=${fresh}`;
    await sendMail('verify', { to: user.email, link, language: user.language });
    throw badRequest('Havola muddati tugagan. Emailingizga yangi havola yubordik.');
  }
  const updated = await Users.update(user.id, { email_verified: 1, verify_token: null });
  await Audit.add(user.id, 'email_verified', '', ctx.ip);
  ok(ctx.res, { user: Users.publik(updated) });
});

authRoutes.post('/resend-verification', requireAuth, async (ctx) => {
  if (ctx.user.email_verified) return ok(ctx.res, { alreadyVerified: true });
  const token = randomToken(24);
  await Users.update(ctx.user.id, { verify_token: token });
  const link = `${origin(ctx)}/#/verify?token=${token}`;
  await sendMail('verify', { to: ctx.user.email, link, language: ctx.user.language });
  ok(ctx.res, { sent: true, ...(config.exposeDevLinks ? { devVerifyLink: link } : {}) });
});

/* ── Parolni unutdim ────────────────────────────────────────────────── */
authRoutes.post('/forgot-password', async (ctx) => {
  const body = await readJson(ctx.req);
  const email = v.email(body.email);
  const user = await Users.byEmail(email);

  // Email mavjudligini oshkor qilmaymiz — javob har doim bir xil
  let devLink;
  if (user) {
    const token = randomToken(32);
    await Users.update(user.id, { reset_token: token, reset_expires: Date.now() + RESET_TTL });
    devLink = `${origin(ctx)}/#/reset?token=${token}`;
    await sendMail('reset', { to: user.email, link: devLink, language: user.language });
    await Audit.add(user.id, 'password_reset_requested', '', ctx.ip);
  }

  ok(ctx.res, {
    message: 'Agar bu email ro‘yxatdan o‘tgan bo‘lsa, tiklash havolasi yuborildi',
    ...(config.exposeDevLinks && devLink ? { devResetLink: devLink } : {}),
  });
});

authRoutes.post('/reset-password', async (ctx) => {
  const body = await readJson(ctx.req);
  const token = v.string(body.token, 'token', { min: 10, max: 200 });
  const password = v.password(body.password);

  const user = await Users.byResetToken(token);
  if (!user || !user.reset_expires || user.reset_expires < Date.now()) {
    throw badRequest('Tiklash havolasi yaroqsiz yoki muddati tugagan');
  }

  await Users.update(user.id, { password_hash: hashPassword(password), reset_token: null, reset_expires: null });
  await Sessions.revokeAll(user.id);           // barcha qurilmalardan chiqarish
  await Audit.add(user.id, 'password_reset', '', ctx.ip);
  ok(ctx.res, { message: 'Parol yangilandi. Endi yangi parol bilan kiring.' });
});

/* ── Joriy foydalanuvchi va sessiyalar ──────────────────────────────── */
authRoutes.get('/me', requireAuth, async (ctx) => {
  ok(ctx.res, { user: Users.publik(ctx.user) });
});

authRoutes.get('/sessions', requireAuth, async (ctx) => {
  const list = (await Sessions.listFor(ctx.user.id)).map((s) => ({
    id: s.id,
    device: describeDevice(s.user_agent),
    ip: s.ip,
    createdAt: s.created_at,
    lastSeen: s.last_seen,
    expiresAt: s.expires_at,
  }));
  ok(ctx.res, { sessions: list });
});

authRoutes.delete('/sessions/:id', requireAuth, async (ctx) => {
  const res = await Sessions.revoke(ctx.params.id, ctx.user.id);
  if (!res.changes) throw notFound('Sessiya topilmadi');
  ok(ctx.res, {});
});

authRoutes.post('/sessions/revoke-all', requireAuth, async (ctx) => {
  await Sessions.revokeAll(ctx.user.id);
  clearRefreshCookie(ctx.res);
  await Audit.add(ctx.user.id, 'sessions_revoked', '', ctx.ip);
  ok(ctx.res, {});
});

function describeDevice(ua = '') {
  const s = String(ua);
  const os = /Windows/i.test(s) ? 'Windows' : /Mac OS/i.test(s) ? 'macOS' : /Android/i.test(s) ? 'Android'
    : /iPhone|iPad/i.test(s) ? 'iOS' : /Linux/i.test(s) ? 'Linux' : 'Noma’lum OS';
  const br = /Edg\//i.test(s) ? 'Edge' : /OPR\//i.test(s) ? 'Opera' : /Chrome\//i.test(s) ? 'Chrome'
    : /Safari\//i.test(s) ? 'Safari' : /Firefox\//i.test(s) ? 'Firefox' : 'Brauzer';
  return `${br} · ${os}`;
}
