/**
 * Ma'lumotlar bazasi qatlami — ikki rejim, bitta async interfeys:
 *
 *   TURSO_DATABASE_URL bor  -> Turso (libSQL) — HTTP pipeline API orqali, tashqi SDK'siz
 *   yo'q                     -> lokal SQLite fayli (node:sqlite)
 *
 * Repozitoriylar ikkala rejimda ham bir xil ishlaydi. Bog'liq yozuvlarni
 * o'chirish ON DELETE CASCADE'ga tayanmaydi — aniq bajariladi, chunki Turso'da
 * har HTTP so'rov alohida ulanish va foreign_keys pragma'si saqlanmaydi.
 */
import { config } from '../config.js';
import { uid } from './crypto.js';
import { log } from './logger.js';

/* ═══ Drayverlar ═══════════════════════════════════════════════════════ */

async function createLocalDriver(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const norm = (args) => args.map((a) => (typeof a === 'boolean' ? Number(a) : a ?? null));

  return {
    kind: 'sqlite',
    async all(sql, args = []) { return db.prepare(sql).all(...norm(args)); },
    async get(sql, args = []) { return db.prepare(sql).get(...norm(args)) ?? null; },
    async run(sql, args = []) {
      const r = db.prepare(sql).run(...norm(args));
      return { changes: Number(r.changes) };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        for (const s of statements) db.prepare(s.sql).run(...norm(s.args || []));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async close() { db.close(); },
  };
}

function createTursoDriver(url, authToken) {
  const endpoint = url.replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '') + '/v2/pipeline';

  /* JS qiymati -> Hrana formati */
  const encode = (v) => {
    if (v === null || v === undefined) return { type: 'null' };
    if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
    if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
    if (typeof v === 'number') {
      return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
    }
    if (v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') };
    return { type: 'text', value: String(v) };
  };

  /* Hrana formati -> JS qiymati */
  const decode = (cell) => {
    switch (cell?.type) {
      case 'integer': return Number(cell.value);
      case 'float': return Number(cell.value);
      case 'text': return cell.value;
      case 'blob': return Buffer.from(cell.base64 || '', 'base64');
      default: return null;
    }
  };

  async function pipeline(statements) {
    const requests = statements.map((s) => ({
      type: 'execute',
      stmt: { sql: s.sql, args: (s.args || []).map(encode) },
    }));
    requests.push({ type: 'close' });

    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requests }),
      });
    } catch (err) {
      throw new Error(`Turso bilan aloqa yo'q: ${err.cause?.code || err.message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new Error('Turso: auth token yaroqsiz yoki muddati tugagan (TURSO_AUTH_TOKEN)');
      }
      throw new Error(`Turso HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return statements.map((_, i) => {
      const item = data.results?.[i];
      if (!item || item.type === 'error') {
        const msg = item?.error?.message || 'noma’lum xato';
        throw new Error(`Turso SQL xatosi: ${msg}`);
      }
      const result = item.response.result;
      const names = result.cols.map((c) => c.name);
      return {
        rows: result.rows.map((row) => Object.fromEntries(row.map((cell, j) => [names[j], decode(cell)]))),
        changes: result.affected_row_count ?? 0,
      };
    });
  }

  return {
    kind: 'turso',
    async all(sql, args = []) { return (await pipeline([{ sql, args }]))[0].rows; },
    async get(sql, args = []) { return (await pipeline([{ sql, args }]))[0].rows[0] ?? null; },
    async run(sql, args = []) { return { changes: (await pipeline([{ sql, args }]))[0].changes }; },
    async batch(statements) {
      // Bitta pipeline = bitta ulanish. Xato bo'lsa, ulanish yopilganda tranzaksiya bekor qilinadi.
      await pipeline([{ sql: 'BEGIN' }, ...statements, { sql: 'COMMIT' }]);
    },
    async close() {},
  };
}

/* ═══ Ishga tushirish ══════════════════════════════════════════════════ */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    full_name      TEXT NOT NULL,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    avatar         TEXT,
    language       TEXT NOT NULL DEFAULT 'uz',
    theme          TEXT NOT NULL DEFAULT 'system',
    notifications  INTEGER NOT NULL DEFAULT 1,
    email_verified INTEGER NOT NULL DEFAULT 0,
    verify_token   TEXT,
    reset_token    TEXT,
    reset_expires  INTEGER,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_hash TEXT NOT NULL,
    user_agent   TEXT,
    ip           TEXT,
    created_at   INTEGER NOT NULL,
    last_seen    INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(refresh_hash)',
  `CREATE TABLE IF NOT EXISTS chats (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    domain     TEXT,
    archived   INTEGER NOT NULL DEFAULT 0,
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    meta       TEXT,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at)',
  `CREATE TABLE IF NOT EXISTS files (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id     TEXT REFERENCES chats(id) ON DELETE SET NULL,
    message_id  TEXT,
    name        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    kind        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    text_len    INTEGER NOT NULL DEFAULT 0,
    extract     TEXT,
    summary     TEXT,
    scan_status TEXT NOT NULL DEFAULT 'clean',
    scan_note   TEXT,
    created_at  INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id, created_at DESC)',
  `CREATE TABLE IF NOT EXISTS audit (
    id         TEXT PRIMARY KEY,
    user_id    TEXT,
    type       TEXT NOT NULL,
    detail     TEXT,
    ip         TEXT,
    created_at INTEGER NOT NULL
  )`,
  // Har bir AI so'rovi (xabar yoki qayta generatsiya) — limit va statistika uchun
  `CREATE TABLE IF NOT EXISTS usage_events (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    chat_id    TEXT,
    kind       TEXT NOT NULL,
    provider   TEXT,
    model      TEXT,
    tokens_in  INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_events(created_at)',
];

/**
 * Mavjud bazaga keyinroq qo'shilgan ustunlar.
 * SQLite'da "ADD COLUMN IF NOT EXISTS" yo'q, shuning uchun avval tekshiramiz.
 */
const COLUMN_MIGRATIONS = {
  users: [
    ['role', "TEXT NOT NULL DEFAULT 'user'"],
    ['tier', "TEXT NOT NULL DEFAULT 'free'"],
    ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ['block_reason', 'TEXT'],
    ['blocked_at', 'INTEGER'],
    ['last_seen_at', 'INTEGER'],
  ],
};

async function migrateColumns() {
  for (const [table, columns] of Object.entries(COLUMN_MIGRATIONS)) {
    const existing = new Set((await driver.all(`PRAGMA table_info(${table})`)).map((c) => c.name));
    const missing = columns.filter(([name]) => !existing.has(name));
    if (!missing.length) continue;
    await driver.batch(missing.map(([name, def]) => ({ sql: `ALTER TABLE ${table} ADD COLUMN ${name} ${def}` })));
    log.info(`Migratsiya: ${table} jadvaliga ${missing.map(([n]) => n).join(', ')} qo‘shildi`);
  }
}

const driver = config.db.url
  ? createTursoDriver(config.db.url, config.db.authToken)
  : await createLocalDriver(config.db.file);

try {
  await driver.batch(SCHEMA.map((sql) => ({ sql })));
  await migrateColumns();
  // Status/tier bo'yicha filtrlash uchun indeks (ustunlar migratsiyadan keyin mavjud)
  await driver.run('CREATE INDEX IF NOT EXISTS idx_users_status ON users(status, tier)');
  await syncAdmins();
} catch (err) {
  log.error('Bazani ishga tushirib bo‘lmadi:', err.message);
  process.exit(1);
}

/** ADMIN_EMAILS dagi hisoblarga admin rolini beradi, ro'yxatdan chiqarilganlarni oddiy foydalanuvchiga qaytaradi. */
async function syncAdmins() {
  const emails = config.adminEmails;
  if (emails.length) {
    const marks = emails.map(() => '?').join(',');
    await driver.batch([
      { sql: `UPDATE users SET role = 'admin' WHERE email IN (${marks})`, args: emails },
      { sql: `UPDATE users SET role = 'user' WHERE role = 'admin' AND email NOT IN (${marks})`, args: emails },
    ]);
  } else {
    await driver.run("UPDATE users SET role = 'user' WHERE role = 'admin'");
  }
}

log.ok(`Database ready: ${driver.kind === 'turso' ? config.db.url : config.db.file}`);

export const dbKind = driver.kind;
export const now = () => Date.now();

const parseMeta = (m) => { try { return m ? JSON.parse(m) : null; } catch { return null; } };

/* ═══ Repozitoriylar ═══════════════════════════════════════════════════ */

/* ── Users ── */
// "role" bu yerda yo'q: rol faqat ADMIN_EMAILS orqali boshqariladi (syncAdmins)
const USER_FIELDS = ['full_name', 'avatar', 'language', 'theme', 'notifications', 'password_hash',
  'email_verified', 'verify_token', 'reset_token', 'reset_expires',
  'tier', 'status', 'block_reason', 'blocked_at'];

export const Users = {
  async create({ fullName, email, passwordHash, language = 'uz', verifyToken = null }) {
    const id = uid('usr');
    const t = now();
    const normalized = String(email).toLowerCase();
    const role = config.adminEmails.includes(normalized) ? 'admin' : 'user';
    await driver.run(
      `INSERT INTO users (id, full_name, email, password_hash, language, verify_token, role, created_at, updated_at, last_seen_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, fullName, normalized, passwordHash, language, verifyToken, role, t, t, t]
    );
    return this.byId(id);
  },
  /** Oxirgi faollik vaqti (chaqiruvchi tomonda throttling qilinadi). */
  touchSeen: (id) => driver.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [now(), id]),
  byId: (id) => driver.get('SELECT * FROM users WHERE id = ?', [id]),
  byEmail: (email) => driver.get('SELECT * FROM users WHERE email = ?', [String(email).toLowerCase()]),
  byVerifyToken: (t) => driver.get('SELECT * FROM users WHERE verify_token = ?', [t]),
  byResetToken: (t) => driver.get('SELECT * FROM users WHERE reset_token = ?', [t]),
  async update(id, patch) {
    const keys = Object.keys(patch).filter((k) => USER_FIELDS.includes(k));
    if (keys.length) {
      await driver.run(
        `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...keys.map((k) => patch[k]), now(), id]
      );
    }
    return this.byId(id);
  },
  /** Foydalanuvchi va unga tegishli barcha yozuvlarni bitta tranzaksiyada o'chiradi. */
  async remove(id) {
    await driver.batch([
      { sql: 'DELETE FROM usage_events WHERE user_id = ?', args: [id] },
      { sql: 'DELETE FROM messages WHERE user_id = ?', args: [id] },
      { sql: 'DELETE FROM files WHERE user_id = ?', args: [id] },
      { sql: 'DELETE FROM chats WHERE user_id = ?', args: [id] },
      { sql: 'DELETE FROM sessions WHERE user_id = ?', args: [id] },
      { sql: 'DELETE FROM users WHERE id = ?', args: [id] },
    ]);
  },
  publik(u) {
    if (!u) return null;
    return {
      id: u.id, fullName: u.full_name, email: u.email, avatar: u.avatar,
      language: u.language, theme: u.theme, notifications: !!u.notifications,
      emailVerified: !!u.email_verified, createdAt: u.created_at,
      role: u.role || 'user', tier: u.tier || 'free', status: u.status || 'active',
    };
  },
};

/* ── Sessions ── */
export const Sessions = {
  async create({ userId, refreshHash, userAgent, ip, ttlSeconds }) {
    const id = uid('ses');
    const t = now();
    await driver.run(
      `INSERT INTO sessions (id, user_id, refresh_hash, user_agent, ip, created_at, last_seen, expires_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, userId, refreshHash, userAgent ?? '', ip ?? '', t, t, t + ttlSeconds * 1000]
    );
    return id;
  },
  byHash: (h) => driver.get('SELECT * FROM sessions WHERE refresh_hash = ?', [h]),
  listFor: (userId) => driver.all(
    `SELECT id, user_agent, ip, created_at, last_seen, expires_at
     FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC`,
    [userId, now()]
  ),
  rotate: (id, refreshHash, ttlSeconds) => driver.run(
    'UPDATE sessions SET refresh_hash = ?, last_seen = ?, expires_at = ? WHERE id = ?',
    [refreshHash, now(), now() + ttlSeconds * 1000, id]
  ),
  revoke: (id, userId) => driver.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', [id, userId]),
  revokeAll: (userId) => driver.run('DELETE FROM sessions WHERE user_id = ?', [userId]),
  purgeExpired: () => driver.run('DELETE FROM sessions WHERE expires_at < ?', [now()]),
};

/* ── Chats ── */
const CHAT_FIELDS = ['title', 'archived', 'pinned', 'domain'];

export const Chats = {
  async create(userId, title = 'Yangi suhbat') {
    const id = uid('cht');
    const t = now();
    await driver.run(
      'INSERT INTO chats (id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?)',
      [id, userId, title, t, t]
    );
    return this.byId(id, userId);
  },
  byId: (id, userId) => driver.get('SELECT * FROM chats WHERE id = ? AND user_id = ?', [id, userId]),
  list(userId, { archived = 0, search = '' } = {}) {
    if (search) {
      const like = `%${String(search).toLowerCase()}%`;
      return driver.all(
        `SELECT c.* FROM chats c
         WHERE c.user_id = ? AND c.archived = ?
           AND (lower(c.title) LIKE ?
                OR EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND lower(m.content) LIKE ?))
         ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 200`,
        [userId, archived, like, like]
      );
    }
    return driver.all(
      `SELECT * FROM chats WHERE user_id = ? AND archived = ?
       ORDER BY pinned DESC, updated_at DESC LIMIT 200`,
      [userId, archived]
    );
  },
  async update(id, userId, patch) {
    const keys = Object.keys(patch).filter((k) => CHAT_FIELDS.includes(k));
    if (keys.length) {
      await driver.run(
        `UPDATE chats SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`,
        [...keys.map((k) => patch[k]), now(), id, userId]
      );
    }
    return this.byId(id, userId);
  },
  touch: (id) => driver.run('UPDATE chats SET updated_at = ? WHERE id = ?', [now(), id]),
  /** Suhbat va uning xabarlarini o'chiradi; fayllar suhbatdan uziladi. Natija: o'chirildimi. */
  async remove(id, userId) {
    const chat = await this.byId(id, userId);
    if (!chat) return false;
    await driver.batch([
      { sql: 'DELETE FROM messages WHERE chat_id = ?', args: [id] },
      { sql: 'UPDATE files SET chat_id = NULL WHERE chat_id = ?', args: [id] },
      { sql: 'DELETE FROM chats WHERE id = ? AND user_id = ?', args: [id, userId] },
    ]);
    return true;
  },
  async count(userId) {
    const r = await driver.get('SELECT COUNT(*) AS n FROM chats WHERE user_id = ?', [userId]);
    return Number(r?.n ?? 0);
  },
  publik: (c) => c && ({
    id: c.id, title: c.title, domain: c.domain,
    archived: !!c.archived, pinned: !!c.pinned,
    createdAt: c.created_at, updatedAt: c.updated_at,
  }),
};

/* ── Messages ── */
export const Messages = {
  async add({ chatId, userId, role, content, meta = null }) {
    const id = uid('msg');
    const t = now();
    await driver.batch([
      {
        sql: 'INSERT INTO messages (id, chat_id, user_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?,?)',
        args: [id, chatId, userId, role, content, meta ? JSON.stringify(meta) : null, t],
      },
      { sql: 'UPDATE chats SET updated_at = ? WHERE id = ?', args: [t, chatId] },
    ]);
    return this.byId(id);
  },
  async byId(id) {
    const m = await driver.get('SELECT * FROM messages WHERE id = ?', [id]);
    return m ? Messages.publik(m) : null;
  },
  async list(chatId, limit = 500) {
    const rows = await driver.all(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT ?', [chatId, limit]
    );
    return rows.map((m) => Messages.publik(m));
  },
  async history(chatId, limit = 20) {
    const rows = await driver.all(
      'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?', [chatId, limit]
    );
    return rows.reverse();
  },
  async countFor(userId) {
    const r = await driver.get('SELECT COUNT(*) AS n FROM messages WHERE user_id = ?', [userId]);
    return Number(r?.n ?? 0);
  },
  remove: (id) => driver.run('DELETE FROM messages WHERE id = ?', [id]),
  publik: (m) => ({
    id: m.id, chatId: m.chat_id, role: m.role, content: m.content,
    meta: parseMeta(m.meta), createdAt: m.created_at,
  }),
};

/* ── Files ── */
export const Files = {
  async create(f) {
    const id = uid('fil');
    await driver.run(
      `INSERT INTO files (id,user_id,chat_id,message_id,name,mime,kind,size,storage_key,text_len,extract,summary,scan_status,scan_note,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, f.userId, f.chatId ?? null, f.messageId ?? null, f.name, f.mime, f.kind, f.size,
        f.storageKey, f.textLen ?? 0, f.extract ?? null, f.summary ?? null,
        f.scanStatus ?? 'clean', f.scanNote ?? null, now()]
    );
    return this.byId(id, f.userId);
  },
  async byId(id, userId) {
    const r = await this.raw(id, userId);
    return r ? Files.publik(r) : null;
  },
  raw: (id, userId) => driver.get('SELECT * FROM files WHERE id = ? AND user_id = ?', [id, userId]),
  attach: (id, chatId, messageId) =>
    driver.run('UPDATE files SET chat_id = ?, message_id = ? WHERE id = ?', [chatId, messageId, id]),
  /** Diskdan o'chirish uchun: suhbatga tegishli fayllarning xom yozuvlari. */
  rawForChat: (userId, chatId) =>
    driver.all('SELECT * FROM files WHERE user_id = ? AND chat_id = ?', [userId, chatId]),
  rawForUser: (userId) => driver.all('SELECT * FROM files WHERE user_id = ?', [userId]),
  async listForChat(userId, chatId) {
    const rows = await driver.all(
      'SELECT * FROM files WHERE user_id = ? AND chat_id = ? ORDER BY created_at', [userId, chatId]
    );
    return rows.map((r) => Files.publik(r));
  },
  async countFor(userId) {
    const r = await driver.get('SELECT COUNT(*) AS n FROM files WHERE user_id = ?', [userId]);
    return Number(r?.n ?? 0);
  },
  remove: (id, userId) => driver.run('DELETE FROM files WHERE id = ? AND user_id = ?', [id, userId]),
  publik: (r) => ({
    id: r.id, name: r.name, mime: r.mime, kind: r.kind, size: r.size,
    textLen: r.text_len, summary: r.summary, scanStatus: r.scan_status,
    scanNote: r.scan_note, createdAt: r.created_at,
  }),
};

/* ── Audit ── */
export const Audit = {
  async add(userId, type, detail = '', ip = '') {
    try {
      await driver.run(
        'INSERT INTO audit (id,user_id,type,detail,ip,created_at) VALUES (?,?,?,?,?,?)',
        [uid('aud'), userId ?? null, type, detail, ip, now()]
      );
    } catch (err) {
      // Audit yozuvi asosiy amalni to'xtatmasligi kerak
      log.warn('Audit yozilmadi:', err.message);
    }
  },
  recent: (userId, limit = 20) => driver.all(
    'SELECT type, detail, ip, created_at FROM audit WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, limit]
  ),
};

/* ── Usage: AI so'rovlari hisobi ── */
const DAY_MS = 24 * 60 * 60 * 1000;

export const Usage = {
  async record({ userId, chatId = null, kind = 'message', provider = null, model = null, tokensIn = 0, tokensOut = 0 }) {
    await driver.run(
      `INSERT INTO usage_events (id, user_id, chat_id, kind, provider, model, tokens_in, tokens_out, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [uid('use'), userId, chatId, kind, provider, model, Math.max(0, tokensIn | 0), Math.max(0, tokensOut | 0), now()]
    );
  },

  /** So'nggi 24 soatdagi so'rovlar soni va eng eski so'rov vaqti (limit qachon bo'shashini hisoblash uchun). */
  async window(userId) {
    const since = now() - DAY_MS;
    const r = await driver.get(
      'SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM usage_events WHERE user_id = ? AND created_at >= ?',
      [userId, since]
    );
    return { used: Number(r?.n ?? 0), oldest: r?.oldest ?? null };
  },

  /** Oxirgi N kun bo'yicha kunlik so'rov va tokenlar (UTC kunlari). */
  async daily(userId, days = 14) {
    const since = now() - days * DAY_MS;
    const rows = await driver.all(
      `SELECT (created_at / ${DAY_MS}) AS day, COUNT(*) AS requests, COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens
       FROM usage_events WHERE user_id = ? AND created_at >= ?
       GROUP BY day ORDER BY day`,
      [userId, since]
    );
    const byDay = new Map(rows.map((r) => [Number(r.day), r]));
    const today = Math.floor(now() / DAY_MS);
    return Array.from({ length: days }, (_, i) => {
      const day = today - (days - 1 - i);
      const r = byDay.get(day);
      return { date: new Date(day * DAY_MS).toISOString().slice(0, 10), requests: Number(r?.requests ?? 0), tokens: Number(r?.tokens ?? 0) };
    });
  },
};

/* ── Admin: foydalanuvchilar va umumiy statistika ── */
const ADMIN_SORTS = {
  last_seen: 'COALESCE(u.last_seen_at, 0) DESC',
  newest: 'u.created_at DESC',
  requests: 'requests DESC',
  tokens: 'tokens DESC',
};

/** Foydalanuvchi + foydalanish ko'rsatkichlari (birinchi "?" — 24 soatlik oyna boshi). */
const ADMIN_USER_SELECT = `
  SELECT u.id, u.full_name, u.email, u.avatar, u.role, u.tier, u.status, u.block_reason,
         u.blocked_at, u.created_at, u.last_seen_at,
         (SELECT COUNT(*) FROM chats c WHERE c.user_id = u.id) AS chats,
         (SELECT COUNT(*) FROM files f WHERE f.user_id = u.id) AS files,
         (SELECT COUNT(*) FROM usage_events e WHERE e.user_id = u.id) AS requests,
         (SELECT COUNT(*) FROM usage_events e WHERE e.user_id = u.id AND e.created_at >= ?) AS requests_24h,
         (SELECT COALESCE(SUM(e.tokens_in + e.tokens_out), 0) FROM usage_events e WHERE e.user_id = u.id) AS tokens
  FROM users u`;

export const Admin = {
  /** Bitta foydalanuvchi — aniq ID bo'yicha. */
  async getUser(id) {
    const row = await driver.get(`${ADMIN_USER_SELECT} WHERE u.id = ?`, [now() - DAY_MS, id]);
    return row ? Admin.publikRow(row) : null;
  },

  async listUsers({ search = '', status = '', tier = '', sort = 'last_seen', limit = 50, offset = 0 } = {}) {
    const since = now() - DAY_MS;
    const like = `%${String(search).toLowerCase()}%`;
    const where = `(? = '' OR lower(u.full_name) LIKE ? OR u.email LIKE ?)
                   AND (? = '' OR u.status = ?)
                   AND (? = '' OR u.tier = ?)`;
    const whereArgs = [search, like, like, status, status, tier, tier];

    const rows = await driver.all(
      `${ADMIN_USER_SELECT}
       WHERE ${where}
       ORDER BY ${ADMIN_SORTS[sort] || ADMIN_SORTS.last_seen}
       LIMIT ? OFFSET ?`,
      [since, ...whereArgs, Math.min(Math.max(limit | 0, 1), 200), Math.max(offset | 0, 0)]
    );
    const total = await driver.get(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`, whereArgs);
    return { users: rows.map(Admin.publikRow), total: Number(total?.n ?? 0) };
  },

  async stats() {
    const since = now() - DAY_MS;
    const onlineSince = now() - 5 * 60 * 1000;
    const [users, usage, tiers] = await Promise.all([
      driver.get(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
                SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS online,
                SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS active_24h,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_24h
         FROM users`,
        [onlineSince, since, since]
      ),
      driver.get(
        `SELECT COUNT(*) AS requests_24h, COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens_24h
         FROM usage_events WHERE created_at >= ?`,
        [since]
      ),
      driver.all('SELECT tier, COUNT(*) AS n FROM users GROUP BY tier'),
    ]);
    return {
      users: Number(users?.total ?? 0),
      blocked: Number(users?.blocked ?? 0),
      online: Number(users?.online ?? 0),
      active24h: Number(users?.active_24h ?? 0),
      new24h: Number(users?.new_24h ?? 0),
      requests24h: Number(usage?.requests_24h ?? 0),
      tokens24h: Number(usage?.tokens_24h ?? 0),
      tiers: Object.fromEntries(tiers.map((t) => [t.tier, Number(t.n)])),
    };
  },

  publikRow: (u) => ({
    id: u.id,
    fullName: u.full_name,
    email: u.email,
    avatar: u.avatar,
    role: u.role,
    tier: u.tier,
    status: u.status,
    blockReason: u.block_reason,
    blockedAt: u.blocked_at,
    createdAt: u.created_at,
    lastSeenAt: u.last_seen_at,
    chats: Number(u.chats ?? 0),
    files: Number(u.files ?? 0),
    requests: Number(u.requests ?? 0),
    requests24h: Number(u.requests_24h ?? 0),
    tokens: Number(u.tokens ?? 0),
  }),
};
