/**
 * API smoke test — serverni alohida portda ishga tushirib, asosiy oqimlarni tekshiradi.
 *
 *   npm test                    -> lokal SQLite (vaqtinchalik papkada)
 *   npm run test:turso          -> .env dagi TURSO_DATABASE_URL bilan
 *
 * AI provayderi o'chiriladi (lokal engine), shuning uchun test API kalit sarflamaydi.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USE_TURSO = process.argv.includes('--turso');
const PORT = 3000 + Math.floor(Math.random() * 900) + 100;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zehn-smoke-'));
const RUN = Date.now().toString(36);
const FREE_LIMIT = 4;
const ADMIN_EMAIL = `admin-${RUN}@zehn.test`;

let passed = 0;
let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/* ── Serverni ishga tushirish ── */
const env = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: String(PORT),
  DATA_DIR,
  ADMIN_EMAILS: ADMIN_EMAIL,
  TIER_FREE_DAILY: String(FREE_LIMIT),
  TIER_PRO_DAILY: '300',
  // AI'ni o'chiramiz — lokal engine ishlaydi
  AI_PROVIDER: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '',
};
if (!USE_TURSO) { env.TURSO_DATABASE_URL = ''; env.TURSO_AUTH_TOKEN = ''; }

const server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

/** Server jarayoni tugashini kutib, keyin papkani o'chiramiz (Windows faylni qulflab turadi). */
const cleanup = async () => {
  if (server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    console.log(`  (vaqtinchalik papka qoldi: ${DATA_DIR})`);
  }
};

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return r.json();
    } catch { /* hali tayyor emas */ }
    if (server.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Server ishga tushmadi:\n' + serverLog.slice(-1500));
}

/* ── HTTP klient: har bir foydalanuvchining o'z tokeni va cookie'si ── */
function client() {
  const c = { token: null, cookie: '' };

  c.api = async (method, url, body, { raw = false } = {}) => {
    const headers = {};
    if (c.token) headers.authorization = `Bearer ${c.token}`;
    if (c.cookie) headers.cookie = c.cookie;
    if (body && !raw) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + url, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) c.cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };

  c.sse = async (url, body) => {
    const res = await fetch(BASE + url, {
      method: 'POST',
      headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const type = res.headers.get('content-type') || '';
    if (!type.includes('event-stream')) return { status: res.status, events: {}, error: await res.json() };
    const text = await res.text();
    const events = {};
    for (const block of text.split('\n\n')) {
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (ev && data) (events[ev] ||= []).push(JSON.parse(data));
    }
    return { status: res.status, events };
  };

  c.register = async (email, password, fullName = 'Test User') => {
    const r = await c.api('POST', '/api/auth/register', { fullName, email, password, confirmPassword: password });
    c.token = r.data.accessToken;
    return r;
  };

  c.login = async (email, password) => {
    const r = await c.api('POST', '/api/auth/login', { email, password });
    if (r.data.accessToken) c.token = r.data.accessToken;
    return r;
  };

  return c;
}

/* ── Testlar ── */
try {
  const health = await waitForServer();
  console.log(`\nZehn AI smoke test — DB: ${health.db}, port ${PORT}\n`);
  check('health: server ishlayapti', health.ok);
  check(`health: kutilgan baza (${USE_TURSO ? 'turso' : 'sqlite'})`, health.db === (USE_TURSO ? 'turso' : 'sqlite'), `-> ${health.db}`);

  const u = client();

  console.log('\nAutentifikatsiya');
  const email = `smoke-${RUN}@zehn.test`;
  let r = await u.register(email, 'Smoke2026test', 'Smoke Test');
  check('ro‘yxatdan o‘tish', r.status === 201 && r.data.accessToken, JSON.stringify(r.data).slice(0, 200));
  check('yangi foydalanuvchi: free tarif, oddiy rol', r.data.user?.tier === 'free' && r.data.user?.role === 'user');

  r = await u.api('POST', '/api/auth/register', { fullName: 'Dup', email, password: 'Smoke2026test' });
  check('takroriy email rad etiladi (409)', r.status === 409);

  r = await u.api('POST', '/api/auth/login', { email, password: 'noto-gri-parol1' });
  check('noto‘g‘ri parol rad etiladi (401)', r.status === 401);

  r = await u.login(email, 'Smoke2026test');
  check('kirish', r.status === 200 && r.data.user.email === email);

  r = await u.api('GET', '/api/auth/me');
  check('/me joriy foydalanuvchini qaytaradi', r.data.user?.email === email);

  const oldCookie = u.cookie;
  r = await u.api('POST', '/api/auth/refresh');
  check('refresh token rotatsiyasi', r.status === 200 && u.cookie !== oldCookie);
  const fresh = u.cookie;
  u.cookie = oldCookie;
  r = await u.api('POST', '/api/auth/refresh');
  check('eski refresh token qayta ishlamaydi', r.status === 401);
  u.cookie = fresh;

  r = await u.api('GET', '/api/auth/sessions');
  check('sessiyalar ro‘yxati', Array.isArray(r.data.sessions) && r.data.sessions.length >= 1);

  console.log('\nSuhbatlar');
  r = await u.api('POST', '/api/chat/chats', {});
  const chatId = r.data.chat?.id;
  check('suhbat yaratish', r.status === 201 && chatId);

  const msg = await u.sse(`/api/chat/chats/${chatId}/messages`, { content: '2x + 5 = 17 tenglamani yech' });
  check('SSE: user_message', msg.events.user_message?.length === 1);
  check('SSE: pipeline bosqichlari', (msg.events.stage || []).length === 4);
  check('SSE: tahlil (matematika)', msg.events.analysis?.[0]?.domain === 'math');
  const answer = (msg.events.delta || []).map((d) => d.text).join('');
  check('SSE: javob oqimi (x = 6)', answer.includes('x = 6'), answer.slice(0, 120));
  check('SSE: sarlavha yaratildi', !!msg.events.title?.[0]?.title);
  check('SSE: done', !!msg.events.done?.[0]?.message?.id);

  r = await u.api('GET', `/api/chat/chats/${chatId}`);
  check('xabarlar bazada saqlandi (2 ta)', r.data.messages?.length === 2);

  r = await u.api('PATCH', `/api/chat/chats/${chatId}`, { title: 'Yangi nom', pinned: true });
  check('nomini o‘zgartirish va qadash', r.data.chat?.title === 'Yangi nom' && r.data.chat.pinned === true);

  r = await u.api('GET', '/api/chat/chats?q=tenglama');
  check('xabar matni bo‘yicha qidiruv', r.data.chats?.some((c) => c.id === chatId));

  await u.api('PATCH', `/api/chat/chats/${chatId}`, { archived: true });
  const active = await u.api('GET', '/api/chat/chats');
  const archived = await u.api('GET', '/api/chat/chats?archived=1');
  check('arxivlash', !active.data.chats.some((c) => c.id === chatId) && archived.data.chats.some((c) => c.id === chatId));
  await u.api('PATCH', `/api/chat/chats/${chatId}`, { archived: false });

  console.log('\nFayllar');
  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(path.join(ROOT, 'tests/fixtures/test.csv'))], { type: 'text/csv' }), 'test.csv');
  r = await u.api('POST', '/api/files/upload', form, { raw: true });
  const fileId = r.data.files?.[0]?.id;
  check('CSV yuklash va matn ajratish', r.status === 201 && r.data.files[0].textLen > 0);

  const evil = new FormData();
  evil.append('files', new Blob([Buffer.from('4d5a900003000000', 'hex')], { type: 'application/pdf' }), 'hisobot.pdf.exe');
  r = await u.api('POST', '/api/files/upload', evil, { raw: true });
  check('bajariladigan fayl bloklanadi', r.status === 400);

  const withFile = await u.sse(`/api/chat/chats/${chatId}/messages`, { content: 'Bu faylni tahlil qil', fileIds: [fileId] });
  const fileAnswer = (withFile.events.delta || []).map((d) => d.text).join('');
  check('AI fayl mazmunini o‘qidi', fileAnswer.includes('mahsulot') || fileAnswer.includes('Kofe'), fileAnswer.slice(0, 150));

  r = await u.api('GET', '/api/chat/stats');
  check('statistika', r.data.stats?.chats === 1 && r.data.stats.messages === 4 && r.data.stats.files === 1, JSON.stringify(r.data.stats));

  console.log('\nTarif limiti');
  r = await u.api('GET', '/api/user/usage');
  check(`usage: 2/${FREE_LIMIT} ishlatilgan`, r.data.quota?.used === 2 && r.data.quota.limit === FREE_LIMIT, JSON.stringify(r.data.quota));

  for (let i = 0; i < FREE_LIMIT - 2; i++) await u.sse(`/api/chat/chats/${chatId}/messages`, { content: `savol ${i}` });
  const blockedByLimit = await u.sse(`/api/chat/chats/${chatId}/messages`, { content: 'limitdan oshgan savol' });
  check('limit tugaganda 429 TIER_LIMIT', blockedByLimit.status === 429 && blockedByLimit.error?.error?.code === 'TIER_LIMIT',
    JSON.stringify(blockedByLimit.error));
  r = await u.api('GET', `/api/chat/chats/${chatId}`);
  check('rad etilgan xabar saqlanmaydi', r.data.messages?.length === FREE_LIMIT * 2, `-> ${r.data.messages?.length}`);

  console.log('\nAdmin panel');
  r = await u.api('GET', '/api/admin/stats');
  check('oddiy foydalanuvchi admin API\x27ga kira olmaydi (403)', r.status === 403);

  const admin = client();
  r = await admin.register(ADMIN_EMAIL, 'Admin2026test', 'Bosh Admin');
  check('ADMIN_EMAILS dagi hisob admin bo‘ladi', r.data.user?.role === 'admin');

  r = await admin.api('GET', '/api/admin/stats');
  check('umumiy statistika', r.status === 200 && r.data.stats.users >= 2 && r.data.stats.requests24h >= FREE_LIMIT,
    JSON.stringify(r.data.stats));
  check('tarif limitlari qaytadi', r.data.tiers?.free === FREE_LIMIT && r.data.tiers?.premium === 0);

  r = await admin.api('GET', `/api/admin/users?q=${encodeURIComponent(email)}`);
  const row = r.data.users?.find((x) => x.email === email);
  check('foydalanuvchilar ro‘yxati + foydalanish', row && row.requests === FREE_LIMIT && row.requests24h === FREE_LIMIT && row.files === 1,
    JSON.stringify(row));
  const userId = row?.id;

  r = await admin.api('GET', `/api/admin/users?q=${encodeURIComponent('smoke-' + RUN.slice(0, 3))}`);
  check('ism/email bo‘yicha qidiruv', r.data.users?.some((x) => x.id === userId));

  r = await admin.api('GET', `/api/admin/users/${userId}`);
  check('tafsilot: 14 kunlik grafik va faollik', r.data.daily?.length === 14 && r.data.daily.at(-1).requests === FREE_LIMIT
    && Array.isArray(r.data.activity), JSON.stringify(r.data.daily?.at(-1)));

  r = await admin.api('PATCH', `/api/admin/users/${userId}`, { tier: 'pro' });
  check('tarifni Pro ga oshirish', r.status === 200 && r.data.user?.tier === 'pro');
  const afterUpgrade = await u.sse(`/api/chat/chats/${chatId}/messages`, { content: 'endi ishlashi kerak' });
  check('Pro dan keyin xabar yana ishlaydi', afterUpgrade.status === 200 && !!afterUpgrade.events.done);

  r = await admin.api('PATCH', `/api/admin/users/${admin.token ? (await admin.api('GET', '/api/auth/me')).data.user.id : ''}`, { status: 'blocked' });
  check('admin o‘zini bloklay olmaydi', r.status === 400);

  r = await admin.api('PATCH', `/api/admin/users/${userId}`, { status: 'blocked', reason: 'Spam' });
  check('foydalanuvchini bloklash', r.status === 200 && r.data.user?.status === 'blocked' && r.data.user.blockReason === 'Spam');

  r = await u.api('GET', '/api/auth/me');
  check('bloklangan: access token darhol rad etiladi', r.status === 403 && r.data.error?.code === 'ACCOUNT_BLOCKED'
    && r.data.error?.details?.reason === 'Spam', JSON.stringify(r.data));
  r = await u.api('POST', '/api/auth/refresh');
  check('bloklangan: refresh token bekor qilingan', r.status === 401 || r.status === 403);
  r = await u.api('POST', '/api/auth/login', { email, password: 'Smoke2026test' });
  check('bloklangan: qayta kira olmaydi', r.status === 403 && r.data.error?.code === 'ACCOUNT_BLOCKED');
  r = await u.api('POST', '/api/auth/login', { email, password: 'notogri-parol9' });
  check('bloklangan + noto‘g‘ri parol: holat oshkor qilinmaydi (401)', r.status === 401);

  r = await admin.api('GET', '/api/admin/users?status=blocked');
  check('status bo‘yicha filtr', r.data.users?.length >= 1 && r.data.users.every((x) => x.status === 'blocked'));

  r = await admin.api('PATCH', `/api/admin/users/${userId}`, { status: 'active' });
  check('blokdan chiqarish', r.data.user?.status === 'active');
  r = await u.login(email, 'Smoke2026test');
  check('blokdan keyin yana kira oladi', r.status === 200);

  console.log('\nO‘chirish');
  r = await u.api('DELETE', `/api/chat/chats/${chatId}`);
  check('suhbatni o‘chirish', r.status === 200);
  r = await u.api('GET', `/api/chat/chats/${chatId}`);
  check('o‘chirilgan suhbat topilmaydi', r.status === 404);
  r = await u.api('GET', '/api/chat/stats');
  check('xabarlar va fayl yozuvlari ham o‘chdi', r.data.stats?.messages === 0 && r.data.stats.files === 0, JSON.stringify(r.data.stats));

  r = await u.api('POST', '/api/chat/chats', {});
  await u.sse(`/api/chat/chats/${r.data.chat.id}/messages`, { content: 'salom' });

  r = await u.api('GET', '/api/user/export');
  check('ma’lumotlarni eksport', r.status === 200 && r.data.chats?.length === 1);

  r = await u.api('POST', '/api/user/delete-account', { password: 'Smoke2026test' });
  check('akkauntni o‘chirish', r.status === 200);
  r = await u.api('POST', '/api/auth/login', { email, password: 'Smoke2026test' });
  check('o‘chirilgan akkaunt bilan kirib bo‘lmaydi', r.status === 401);

  r = await admin.api('POST', '/api/user/delete-account', { password: 'Admin2026test' });
  check('test admin hisobi tozalandi', r.status === 200);
} catch (err) {
  failed++;
  console.log(`\n\x1b[31mTest to‘xtadi:\x1b[0m ${err.stack || err.message}`);
} finally {
  await cleanup();
  console.log(`\n${passed} ta o‘tdi, ${failed} ta xato\n`);
  process.exit(failed ? 1 : 0);
}
