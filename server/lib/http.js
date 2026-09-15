/** HTTP yordamchilari: JSON javob, xatolar, SSE oqimi. */

export class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest   = (m, d) => new HttpError(400, 'BAD_REQUEST', m, d);
export const unauthorized = (m = 'Avtorizatsiya talab qilinadi') => new HttpError(401, 'UNAUTHORIZED', m);
export const forbidden    = (m = 'Ruxsat yo‘q') => new HttpError(403, 'FORBIDDEN', m);
export const notFound     = (m = 'Topilmadi') => new HttpError(404, 'NOT_FOUND', m);
export const conflict     = (m, d) => new HttpError(409, 'CONFLICT', m, d);
export const tooLarge     = (m) => new HttpError(413, 'PAYLOAD_TOO_LARGE', m);
export const tooMany      = (m = 'Juda ko‘p so‘rov. Birozdan keyin urinib ko‘ring.') => new HttpError(429, 'RATE_LIMITED', m);

export function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function ok(res, data = {}, status = 200) {
  json(res, status, { ok: true, ...data });
}

export function fail(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  const payload = {
    ok: false,
    error: {
      code: err instanceof HttpError ? err.code : 'INTERNAL_ERROR',
      message: status === 500 ? 'Serverda kutilmagan xatolik yuz berdi' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  };
  json(res, status, payload);
}

/** Server-Sent Events kanali (AI javobini oqim sifatida uzatish uchun). */
export function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');
  let closed = false;
  const ka = setInterval(() => { if (!closed) res.write(':ka\n\n'); }, 15000);
  const end = () => { if (closed) return; closed = true; clearInterval(ka); res.end(); };
  res.on('close', () => { closed = true; clearInterval(ka); });
  return {
    send(event, data) {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    get closed() { return closed; },
    end,
  };
}

/** Request body -> Buffer (limit bilan). */
export function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(tooLarge('So‘rov hajmi limitdan oshdi')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit = 1024 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw badRequest('JSON formati noto‘g‘ri'); }
}
