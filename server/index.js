import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { log } from './lib/logger.js';
import { Router } from './lib/router.js';
import { fail, ok, notFound, HttpError } from './lib/http.js';
import { rateLimit } from './lib/ratelimit.js';
import { Sessions, dbKind } from './lib/db.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { fileRoutes } from './routes/files.js';
import { userRoutes } from './routes/user.js';

const PUBLIC_DIR = path.join(ROOT, 'public');

/* ── Router ─────────────────────────────────────────────────────────── */
const api = new Router();
api.use(authRoutes).use(chatRoutes).use(fileRoutes).use(userRoutes);

api.get('/api/health', (ctx) => ok(ctx.res, {
  status: 'up',
  db: dbKind,
  uptime: Math.floor(process.uptime()),
  ai: { enabled: config.ai.enabled, model: config.ai.enabled ? config.ai.model : 'zehn-local-reasoner' },
  version: '1.0.0',
}));

api.get('/api/config', (ctx) => ok(ctx.res, {
  languages: config.languages,
  defaultLanguage: config.defaultLanguage,
  ai: {
    mode: config.ai.enabled ? config.ai.provider : 'local',
    model: config.ai.enabled ? config.ai.model : 'zehn-local-reasoner',
  },
  uploads: {
    maxSize: config.uploads.maxSize,
    maxPerMessage: config.uploads.maxPerMessage,
    accept: [...config.uploads.allowed.keys()],
    extensions: [...new Set([...config.uploads.allowed.values()].map((v) => v.ext))],
  },
}));

/* ── Statik fayllar ─────────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function serveStatic(ctx) {
  let rel = decodeURIComponent(ctx.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR)) throw notFound();          // path traversal himoyasi

  let target = full;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    // SPA fallback: barcha noma'lum yo'llar index.html ga
    if (path.extname(rel)) throw notFound('Fayl topilmadi');
    target = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(target).toLowerCase();
  const stat = fs.statSync(target);
  const etag = `W/"${stat.size}-${stat.mtimeMs.toString(36)}"`;

  if (ctx.headers['if-none-match'] === etag) {
    ctx.res.writeHead(304).end();
    return;
  }

  ctx.res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    ETag: etag,
    // Dev rejimda kesh yo'q — tahrirlar darhol ko'rinadi
    'Cache-Control': ext === '.html' || !config.isProd ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(target).pipe(ctx.res);
}

/* ── Xavfsizlik sarlavhalari ────────────────────────────────────────── */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Google Fonts (Inter + JetBrains Mono); shrift yuklanmasa tizim shriftiga qaytadi
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/* ── So'rovni qayta ishlash ─────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  const ctx = {
    req,
    res,
    method: req.method,
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: req.headers,
    ip: (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '').replace('::ffff:', ''),
    user: null,
    params: {},
  };

  securityHeaders(res);

  res.on('finish', () => {
    if (ctx.pathname.startsWith('/api')) log.request(req, res.statusCode, Date.now() - started);
  });

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { Allow: 'GET, POST, PATCH, DELETE, OPTIONS' }).end();
      return;
    }

    if (ctx.pathname.startsWith('/api')) {
      rateLimit(ctx);
      await api.dispatch(ctx);
      return;
    }

    serveStatic(ctx);
  } catch (err) {
    if (res.writableEnded) return;
    if (!(err instanceof HttpError)) log.error('Kutilmagan xatolik:', err);
    fail(res, err);
  }
});

server.headersTimeout = 65_000;
server.requestTimeout = 300_000;      // uzoq AI oqimlari uchun

/* ── Ishga tushirish ────────────────────────────────────────────────── */
server.listen(config.port, config.host, () => {
  const mode = config.ai.enabled
    ? `${config.ai.provider} (${config.ai.model})`
    : 'LOCAL reasoning engine (API kalit topilmadi)';
  log.ok(`Zehn AI ishga tushdi -> http://${config.host}:${config.port}`);
  log.info(`Rejim: ${config.env} | AI: ${mode} | DB: ${dbKind}`);
  log.info(`Yuklamalar: ${config.uploads.dir}`);
});

// Muddati o'tgan sessiyalarni tozalab turamiz
setInterval(() => {
  Sessions.purgeExpired().catch((err) => log.warn('Sessiyalarni tozalab bo‘lmadi:', err.message));
}, 60 * 60 * 1000).unref();

const shutdown = (signal) => {
  log.warn(`${signal} — server to‘xtatilmoqda...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => log.error('unhandledRejection:', err));
