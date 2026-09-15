import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/* ── Minimal .env loader (tashqi kutubxonasiz) ─────────────────────────── */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    // inline comment'ni olib tashlash (qo'shtirnoq ichida bo'lmasa)
    if (!/^["']/.test(val)) val = val.split(/\s+#/)[0].trim();
    val = val.replace(/^(['"])(.*)\1$/s, '$2');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

/* ── AI provayderi: Gemini yoki Anthropic ──────────────────────────── */
const DEFAULT_MODEL = {
  gemini: 'gemini-3.5-flash',
  anthropic: 'claude-sonnet-5',
};

/** Kalit ko'rinishidan provayderni aniqlaydi (noto'g'ri maydonga qo'yilgan bo'lsa ham). */
function detectProvider(key) {
  if (!key) return null;
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('AIza') || key.startsWith('AQ.')) return 'gemini';
  return null;
}

function aiConfig() {
  const gemini = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  const anthropic = (process.env.ANTHROPIC_API_KEY || '').trim();

  // Aniq ko'rsatilgan bo'lsa — o'shani olamiz, aks holda kalitdan aniqlaymiz
  let provider = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  let apiKey = '';

  if (provider === 'gemini') apiKey = gemini || (detectProvider(anthropic) === 'gemini' ? anthropic : '');
  else if (provider === 'anthropic') apiKey = anthropic;
  else {
    // Avtomatik: mavjud kalitlardan turini aniqlaymiz
    for (const key of [gemini, anthropic]) {
      const guess = detectProvider(key);
      if (guess) { provider = guess; apiKey = key; break; }
    }
    if (!provider && (gemini || anthropic)) {
      provider = gemini ? 'gemini' : 'anthropic';
      apiKey = gemini || anthropic;
    }
  }

  return {
    provider: provider || 'local',
    apiKey,
    model: process.env.AI_MODEL || DEFAULT_MODEL[provider] || 'zehn-local-reasoner',
    maxTokens: int(process.env.AI_MAX_TOKENS, 2048),
    anthropicUrl: 'https://api.anthropic.com/v1/messages',
    anthropicVersion: '2023-06-01',
    get enabled() { return this.apiKey.length > 10 && this.provider !== 'local'; },
  };
}

const ENV = process.env.NODE_ENV || 'development';
const IS_PROD = ENV === 'production';

/* ── Ma'lumotlar papkasi (SQLite + yuklangan fayllar) ────────────────── */
// Hostingda doimiy diskka (volume) yo'naltiriladi, masalan DATA_DIR=/data
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

/* ── Tarmoq ──────────────────────────────────────────────────────────── */
// Productionda tashqi so'rovlarni qabul qilish uchun 0.0.0.0 ga bog'lanadi
const HOST = process.env.HOST || (IS_PROD ? '0.0.0.0' : '127.0.0.1');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/* ── JWT maxfiy kaliti ───────────────────────────────────────────────── */
const PLACEHOLDER_SECRET = 'change-me-to-a-long-random-secret-string-please';

function resolveJwtSecret() {
  const secret = (process.env.JWT_SECRET || '').trim();
  const weak = secret.length < 32 || secret === PLACEHOLDER_SECRET;

  if (IS_PROD && weak) {
    // Productionda tasodifiy kalitga jimgina o'tish xavfli: har restartda
    // barcha foydalanuvchilar tizimdan chiqib ketadi. Shuning uchun to'xtaymiz.
    console.error(
      '\n[FATAL] Productionda JWT_SECRET kamida 32 belgili tasodifiy qator bo‘lishi shart.\n' +
      '        Yaratish: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n'
    );
    process.exit(1);
  }
  return weak ? crypto.randomBytes(32).toString('hex') : secret;
}

/* ── Ma'lumotlar bazasi: Turso yoki lokal SQLite ─────────────────────── */
function resolveDb() {
  const file = path.join(DATA_DIR, 'app.db');
  const url = (process.env.TURSO_DATABASE_URL || '').trim();
  const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim();

  // "file:" bilan boshlangan URL — lokal fayl sifatida qaraladi
  if (!url || url.startsWith('file:')) {
    return { url: '', authToken: '', file: url ? path.resolve(ROOT, url.slice(5)) : file };
  }

  if (!/^(libsql|https):\/\//.test(url)) {
    console.error(`\n[FATAL] TURSO_DATABASE_URL noto‘g‘ri: "${url}" (libsql:// yoki https:// bilan boshlanishi kerak)\n`);
    process.exit(1);
  }
  if (!authToken) {
    console.error(
      '\n[FATAL] TURSO_DATABASE_URL berilgan, lekin TURSO_AUTH_TOKEN yo‘q.\n' +
      '        Token yaratish: Turso panel → Database → Generate Token\n' +
      '        yoki CLI: turso db tokens create <baza-nomi>\n'
    );
    process.exit(1);
  }
  return { url, authToken, file };
}

export const config = {
  env: ENV,
  get isProd() { return IS_PROD; },

  port: int(process.env.PORT, 3000),
  host: HOST,

  /**
   * Parol tiklash / email tasdiqlash havolalarini API javobida qaytarish.
   * Faqat lokal ishlab chiqishda yoqiladi: agar server tashqi manzilga
   * ochiq bo'lsa, bu havolalar begona odamga hisobni egallash imkonini beradi.
   */
  exposeDevLinks: !IS_PROD && LOOPBACK.has(HOST),

  jwtSecret: resolveJwtSecret(),
  accessTtl: int(process.env.ACCESS_TOKEN_TTL, 900),
  refreshTtl: int(process.env.REFRESH_TOKEN_TTL, 60 * 60 * 24 * 30),

  ai: aiConfig(),

  dataDir: DATA_DIR,

  uploads: {
    dir: path.join(DATA_DIR, 'uploads'),
    maxSize: int(process.env.MAX_FILE_SIZE, 10 * 1024 * 1024),
    maxPerMessage: int(process.env.MAX_FILES_PER_MESSAGE, 5),
    allowed: new Map([
      ['application/pdf',                                                          { ext: 'pdf',  kind: 'document'   }],
      ['application/msword',                                                       { ext: 'doc',  kind: 'document'   }],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document',  { ext: 'docx', kind: 'document'   }],
      ['text/plain',                                                               { ext: 'txt',  kind: 'text'       }],
      ['text/markdown',                                                            { ext: 'md',   kind: 'text'       }],
      ['text/csv',                                                                 { ext: 'csv',  kind: 'data'       }],
      ['application/json',                                                         { ext: 'json', kind: 'data'       }],
      ['application/vnd.ms-excel',                                                 { ext: 'xls',  kind: 'spreadsheet'}],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        { ext: 'xlsx', kind: 'spreadsheet'}],
      ['image/png',                                                                { ext: 'png',  kind: 'image'      }],
      ['image/jpeg',                                                               { ext: 'jpg',  kind: 'image'      }],
      ['image/webp',                                                               { ext: 'webp', kind: 'image'      }],
      ['image/gif',                                                                { ext: 'gif',  kind: 'image'      }],
    ]),
  },

  db: resolveDb(),

  limits: {
    // route prefix -> [max so'rov, oyna (ms)]
    '/api/auth': [30, 60_000],
    '/api/chat': [90, 60_000],
    '/api/files': [40, 60_000],
    default: [300, 60_000],
  },

  languages: ['uz', 'ru', 'en'],
  defaultLanguage: 'uz',
};

fs.mkdirSync(config.uploads.dir, { recursive: true });
