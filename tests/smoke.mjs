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

/* ── HTTP yordamchilari ── */
let token = null;
let cookie = '';

async function api(method, url, body, { raw = false } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  if (body && !raw) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

async function sse(url, body) {
  const res = await fetch(BASE + url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const events = {};
  for (const block of text.split('\n\n')) {
    const ev = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    if (ev && data) (events[ev] ||= []).push(JSON.parse(data));
  }
  return { status: res.status, events };
}

/* ── Testlar ── */
try {
  const health = await waitForServer();
  console.log(`\nZehn AI smoke test — DB: ${health.db}, port ${PORT}\n`);
  check('health: server ishlayapti', health.ok);
  check(`health: kutilgan baza (${USE_TURSO ? 'turso' : 'sqlite'})`, health.db === (USE_TURSO ? 'turso' : 'sqlite'), `-> ${health.db}`);

  console.log('\nAutentifikatsiya');
  const email = `smoke-${RUN}@zehn.test`;
  let r = await api('POST', '/api/auth/register', { fullName: 'Smoke Test', email, password: 'Smoke2026test', confirmPassword: 'Smoke2026test' });
  check('ro‘yxatdan o‘tish', r.status === 201 && r.data.accessToken, JSON.stringify(r.data).slice(0, 200));
  token = r.data.accessToken;

  r = await api('POST', '/api/auth/register', { fullName: 'Dup', email, password: 'Smoke2026test' });
  check('takroriy email rad etiladi (409)', r.status === 409);

  r = await api('POST', '/api/auth/login', { email, password: 'noto-gri-parol1' });
  check('noto‘g‘ri parol rad etiladi (401)', r.status === 401);

  r = await api('POST', '/api/auth/login', { email, password: 'Smoke2026test' });
  check('kirish', r.status === 200 && r.data.user.email === email);
  token = r.data.accessToken;

  r = await api('GET', '/api/auth/me');
  check('/me joriy foydalanuvchini qaytaradi', r.data.user?.email === email);

  const oldCookie = cookie;
  r = await api('POST', '/api/auth/refresh');
  check('refresh token rotatsiyasi', r.status === 200 && cookie !== oldCookie);
  const stale = cookie;
  cookie = oldCookie;
  r = await api('POST', '/api/auth/refresh');
  check('eski refresh token qayta ishlamaydi', r.status === 401);
  cookie = stale;

  r = await api('GET', '/api/auth/sessions');
  check('sessiyalar ro‘yxati', Array.isArray(r.data.sessions) && r.data.sessions.length >= 1);

  console.log('\nSuhbatlar');
  r = await api('POST', '/api/chat/chats', {});
  const chatId = r.data.chat?.id;
  check('suhbat yaratish', r.status === 201 && chatId);

  const msg = await sse(`/api/chat/chats/${chatId}/messages`, { content: '2x + 5 = 17 tenglamani yech' });
  check('SSE: user_message', msg.events.user_message?.length === 1);
  check('SSE: pipeline bosqichlari', (msg.events.stage || []).length === 4);
  check('SSE: tahlil (matematika)', msg.events.analysis?.[0]?.domain === 'math');
  const answer = (msg.events.delta || []).map((d) => d.text).join('');
  check('SSE: javob oqimi (x = 6)', answer.includes('x = 6'), answer.slice(0, 120));
  check('SSE: sarlavha yaratildi', !!msg.events.title?.[0]?.title);
  check('SSE: done', !!msg.events.done?.[0]?.message?.id);

  r = await api('GET', `/api/chat/chats/${chatId}`);
  check('xabarlar bazada saqlandi (2 ta)', r.data.messages?.length === 2);

  r = await api('PATCH', `/api/chat/chats/${chatId}`, { title: 'Yangi nom', pinned: true });
  check('nomini o‘zgartirish va qadash', r.data.chat?.title === 'Yangi nom' && r.data.chat.pinned === true);

  r = await api('GET', '/api/chat/chats?q=tenglama');
  check('xabar matni bo‘yicha qidiruv', r.data.chats?.some((c) => c.id === chatId));

  r = await api('PATCH', `/api/chat/chats/${chatId}`, { archived: true });
  const active = await api('GET', '/api/chat/chats');
  const archived = await api('GET', '/api/chat/chats?archived=1');
  check('arxivlash', !active.data.chats.some((c) => c.id === chatId) && archived.data.chats.some((c) => c.id === chatId));
  await api('PATCH', `/api/chat/chats/${chatId}`, { archived: false });

  console.log('\nFayllar');
  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(path.join(ROOT, 'tests/fixtures/test.csv'))], { type: 'text/csv' }), 'test.csv');
  r = await api('POST', '/api/files/upload', form, { raw: true });
  const fileId = r.data.files?.[0]?.id;
  check('CSV yuklash va matn ajratish', r.status === 201 && r.data.files[0].textLen > 0);

  const evil = new FormData();
  evil.append('files', new Blob([Buffer.from('4d5a900003000000', 'hex')], { type: 'application/pdf' }), 'hisobot.pdf.exe');
  r = await api('POST', '/api/files/upload', evil, { raw: true });
  check('bajariladigan fayl bloklanadi', r.status === 400);

  const withFile = await sse(`/api/chat/chats/${chatId}/messages`, { content: 'Bu faylni tahlil qil', fileIds: [fileId] });
  const fileAnswer = (withFile.events.delta || []).map((d) => d.text).join('');
  check('AI fayl mazmunini o‘qidi', fileAnswer.includes('mahsulot') || fileAnswer.includes('Kofe'), fileAnswer.slice(0, 150));

  r = await api('GET', '/api/chat/stats');
  check('statistika', r.data.stats?.chats === 1 && r.data.stats.messages === 4 && r.data.stats.files === 1, JSON.stringify(r.data.stats));

  console.log('\nO‘chirish');
  r = await api('DELETE', `/api/chat/chats/${chatId}`);
  check('suhbatni o‘chirish', r.status === 200);
  r = await api('GET', `/api/chat/chats/${chatId}`);
  check('o‘chirilgan suhbat topilmaydi', r.status === 404);
  r = await api('GET', '/api/chat/stats');
  check('xabarlar va fayl yozuvlari ham o‘chdi', r.data.stats?.messages === 0 && r.data.stats.files === 0, JSON.stringify(r.data.stats));

  r = await api('POST', '/api/chat/chats', {});
  await sse(`/api/chat/chats/${r.data.chat.id}/messages`, { content: 'salom' });

  r = await api('GET', '/api/user/export');
  check('ma’lumotlarni eksport', r.status === 200 && r.data.chats?.length === 1);

  r = await api('POST', '/api/user/delete-account', { password: 'Smoke2026test' });
  check('akkauntni o‘chirish', r.status === 200);
  r = await api('POST', '/api/auth/login', { email, password: 'Smoke2026test' });
  check('o‘chirilgan akkaunt bilan kirib bo‘lmaydi', r.status === 401);
} catch (err) {
  failed++;
  console.log(`\n\x1b[31mTest to‘xtadi:\x1b[0m ${err.message}`);
} finally {
  await cleanup();
  console.log(`\n${passed} ta o‘tdi, ${failed} ta xato\n`);
  process.exit(failed ? 1 : 0);
}
