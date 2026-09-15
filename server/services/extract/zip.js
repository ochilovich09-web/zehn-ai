import zlib from 'node:zlib';

/**
 * Minimal ZIP o'quvchi (docx/xlsx — bu ZIP konteynerlar).
 * Faqat kerakli fayllarni ochadi, butun arxivni xotiraga yozmaydi.
 */
const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export function readZipEntries(buf) {
  // EOCD ni oxiridan qidiramiz (comment 64KB gacha bo'lishi mumkin)
  let eocd = -1;
  const from = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('ZIP: EOCD topilmadi');

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let i = 0; i < count && ptr + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(ptr) !== CEN_SIG) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const uncompSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    entries.set(name, { method, compSize, uncompSize, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function extractZipFile(buf, entries, name) {
  const e = entries.get(name);
  if (!e) return null;
  if (buf.readUInt32LE(e.localOffset) !== LOC_SIG) return null;
  const nameLen = buf.readUInt16LE(e.localOffset + 26);
  const extraLen = buf.readUInt16LE(e.localOffset + 28);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compSize);
  try {
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 });
  } catch { return null; }
  return null;
}

/** XML teglarini olib tashlab, o'qiladigan matn qoldiradi. */
export function xmlToText(xml, { blockTags = [], tabTags = [] } = {}) {
  let s = xml;
  for (const tag of blockTags) s = s.replaceAll(tag, '\n');
  for (const tag of tabTags) s = s.replaceAll(tag, '\t');
  s = s.replace(/<[^>]+>/g, '');
  return decodeEntities(s);
}

export function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}
