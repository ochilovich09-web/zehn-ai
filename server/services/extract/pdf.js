import zlib from 'node:zlib';

/**
 * PDF'dan matn ajratish (tashqi kutubxonasiz).
 *
 * Ishlash tamoyili: barcha `stream ... endstream` bloklari topiladi,
 * FlateDecode bo'lsa ochiladi, so'ng kontent oqimidagi matn operatorlari
 * (Tj, TJ, ', ") o'qiladi.
 *
 * Cheklov: skanerlangan (rasm) PDF'da matn qatlami bo'lmaydi — bunday holatda
 * bo'sh natija qaytadi va foydalanuvchiga shu ochiq aytiladi (OCR ulanmagan).
 */
export function extractPdf(buf, { maxChars = 200000 } = {}) {
  const streams = collectStreams(buf);
  const chunks = [];
  let total = 0;

  for (const s of streams) {
    const text = readContentStream(s);
    if (!text.trim()) continue;
    chunks.push(text);
    total += text.length;
    if (total > maxChars) break;
  }

  const joined = chunks.join('\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return {
    text: joined,
    pages: countPages(buf),
    hasTextLayer: joined.length > 20,
  };
}

function countPages(buf) {
  const s = buf.toString('latin1');
  const byCount = /\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/.exec(s);
  if (byCount) return Number.parseInt(byCount[1], 10);
  const matches = s.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : null;
}

/** Barcha stream bloklarini (kerak bo'lsa ochilgan holda) qaytaradi. */
function collectStreams(buf) {
  const out = [];
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  let pos = 0;

  while (pos < buf.length) {
    const start = buf.indexOf(marker, pos);
    if (start === -1) break;
    // "endstream" so'zi ichidagi "stream" ni o'tkazib yuboramiz
    if (buf.toString('latin1', Math.max(0, start - 3), start) === 'end') { pos = start + 6; continue; }

    let dataStart = start + marker.length;
    if (buf[dataStart] === 0x0d) dataStart++;
    if (buf[dataStart] === 0x0a) dataStart++;

    const end = buf.indexOf(endMarker, dataStart);
    if (end === -1) break;

    const dictStart = Math.max(0, start - 600);
    const dict = buf.toString('latin1', dictStart, start);
    const raw = buf.subarray(dataStart, end);

    // Rasm oqimlarini o'tkazib yuboramiz — ularda matn yo'q
    if (/\/Image|\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode/.test(dict)) { pos = end + 9; continue; }

    if (/\/FlateDecode/.test(dict)) {
      try {
        out.push(zlib.inflateSync(raw, { maxOutputLength: 32 * 1024 * 1024 }).toString('latin1'));
      } catch {
        try { out.push(zlib.inflateRawSync(raw, { maxOutputLength: 32 * 1024 * 1024 }).toString('latin1')); }
        catch { /* buzilgan oqim — o'tkazib yuboramiz */ }
      }
    } else if (!/\/Filter/.test(dict)) {
      out.push(raw.toString('latin1'));
    }
    pos = end + 9;
  }
  return out;
}

/** Kontent oqimidan matn operatorlarini o'qiydi. */
function readContentStream(content) {
  if (!/(Tj|TJ|BT)/.test(content)) return '';
  const lines = [];

  // Matn bloklari: BT ... ET
  const blocks = content.split(/\bBT\b/).slice(1);
  const source = blocks.length ? blocks.map((b) => b.split(/\bET\b/)[0]) : [content];

  for (const block of source) {
    let current = '';
    const rx = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bTJ\b|\bTj\b|\bT\*\b|\bTD\b|\bTd\b/g;
    let m;
    while ((m = rx.exec(block)) !== null) {
      const tok = m[0];
      if (tok.startsWith('(')) current += decodePdfString(tok.slice(1, -1));
      else if (tok.startsWith('<')) current += decodeHexString(tok.slice(1, -1));
      else if (tok === 'T*' || tok === 'TD' || tok === 'Td') {
        if (current.trim()) { lines.push(current.trimEnd()); current = ''; }
      }
    }
    if (current.trim()) lines.push(current.trimEnd());
  }

  return lines.join('\n');
}

const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };

function decodePdfString(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const next = s[++i];
    if (next === undefined) break;
    if (next in ESCAPES) { out += ESCAPES[next]; continue; }
    if (next >= '0' && next <= '7') {           // sakkizlik kod: \101 -> A
      let oct = next;
      while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
      out += String.fromCharCode(Number.parseInt(oct, 8));
      continue;
    }
    out += next;
  }
  return fixEncoding(out);
}

function decodeHexString(hex) {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  // UTF-16BE (BOM FEFF bilan) yoki oddiy bayt ketma-ketligi
  if (/^feff/i.test(clean)) {
    for (let i = 4; i + 4 <= clean.length; i += 4) out += String.fromCharCode(Number.parseInt(clean.slice(i, i + 4), 16));
    return out;
  }
  for (let i = 0; i + 2 <= clean.length; i += 2) out += String.fromCharCode(Number.parseInt(clean.slice(i, i + 2), 16));
  return fixEncoding(out);
}

/** latin1 baytlarni o'qiladigan belgiga aylantirish (Windows-1252 oralig'i). */
function fixEncoding(s) {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code === 0) continue;
    if (code >= 128 && code <= 159) { out += WIN1252[code] ?? ''; continue; }
    out += ch;
  }
  return out;
}

const WIN1252 = {
  128: '€', 130: ',', 131: 'f', 132: '"', 133: '...', 134: '+', 135: '++', 136: '^', 137: '‰',
  139: '<', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 153: '™', 155: '>',
};
