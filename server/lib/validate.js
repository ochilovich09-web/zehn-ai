import { badRequest } from './http.js';

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

export function assert(cond, message, details) {
  if (!cond) throw badRequest(message, details);
}

export const v = {
  string(value, field, { min = 1, max = 5000, trim = true } = {}) {
    if (typeof value !== 'string') throw badRequest(`"${field}" matn bo‘lishi kerak`);
    const s = trim ? value.trim() : value;
    if (s.length < min) throw badRequest(`"${field}" kamida ${min} belgi bo‘lishi kerak`);
    if (s.length > max) throw badRequest(`"${field}" ${max} belgidan oshmasligi kerak`);
    return s;
  },

  email(value) {
    const s = v.string(value, 'email', { min: 5, max: 254 }).toLowerCase();
    if (!EMAIL_RX.test(s)) throw badRequest('Email manzil formati noto‘g‘ri');
    return s;
  },

  /** Parol kuchi: uzunlik + belgilar xilma-xilligi. */
  password(value, field = 'password') {
    const s = v.string(value, field, { min: 8, max: 200, trim: false });
    const checks = {
      length: s.length >= 8,
      lower: /[a-z]/.test(s),
      upper: /[A-Z]/.test(s),
      digit: /[0-9]/.test(s),
      symbol: /[^A-Za-z0-9]/.test(s),
    };
    if (!checks.length) throw badRequest('Parol kamida 8 belgidan iborat bo‘lishi kerak');
    const variety = [checks.lower, checks.upper, checks.digit, checks.symbol].filter(Boolean).length;
    if (variety < 2) throw badRequest('Parol juda oddiy: harf va raqamni birga ishlating', { checks });
    return s;
  },

  oneOf(value, list, field) {
    if (!list.includes(value)) throw badRequest(`"${field}" quyidagilardan biri bo‘lishi kerak: ${list.join(', ')}`);
    return value;
  },

  bool(value) { return value === true || value === 1 || value === 'true' || value === '1'; },

  id(value, field = 'id') {
    const s = v.string(value, field, { min: 3, max: 64 });
    if (!/^[A-Za-z0-9_-]+$/.test(s)) throw badRequest(`"${field}" noto‘g‘ri formatda`);
    return s;
  },
};

const TAB = 9, LF = 10, CR = 13, SPACE = 32, DEL = 127;
const ZERO_WIDTH_START = 0x200b, ZERO_WIDTH_END = 0x200f;
const LINE_SEP = 0x2028, PARA_SEP = 0x2029, BOM = 0xfeff;

/**
 * Ko‘rinmas boshqaruv belgilarini olib tashlaydi.
 * Bu prompt-injection va log-forging hujumlarining oddiy shaklini to‘xtatadi.
 */
export function sanitizeText(input) {
  let out = '';
  for (const ch of String(input)) {
    const c = ch.codePointAt(0);
    if (c < SPACE && c !== TAB && c !== LF && c !== CR) continue;
    if (c === DEL) continue;
    if (c >= ZERO_WIDTH_START && c <= ZERO_WIDTH_END) continue;
    if (c === LINE_SEP || c === PARA_SEP || c === BOM) continue;
    out += ch;
  }
  return out;
}

/** Fayl nomini xavfsiz holga keltiradi (path traversal + maxsus belgilar). */
export function safeFileName(name) {
  const base = String(name).split(/[\\/]/).pop() || 'file';
  const cleaned = base
    .replace(/[^\p{L}\p{N}._\- ()]/gu, '_')
    .replace(/^\.+/, '_')
    .slice(0, 120);
  return cleaned.trim() || 'file';
}
