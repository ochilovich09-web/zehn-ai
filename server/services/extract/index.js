import { extractPdf } from './pdf.js';
import { extractDocx, extractXlsx } from './office.js';
import { sanitizeText } from '../../lib/validate.js';

const MAX_TEXT = 400_000;

/**
 * Fayl turiga qarab matn ajratadi.
 * Natija: { text, note, meta } — note foydalanuvchiga ko'rsatiladigan izoh.
 */
export function extractText(buf, mime, name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();

  try {
    if (mime === 'application/pdf' || ext === 'pdf') {
      const res = extractPdf(buf);
      return {
        text: clip(res.text),
        meta: { pages: res.pages, hasTextLayer: res.hasTextLayer },
        note: res.hasTextLayer
          ? null
          : 'PDF ichida matn qatlami topilmadi — bu skanerlangan hujjat bo‘lishi mumkin (OCR ulanmagan).',
      };
    }

    if (ext === 'docx' || mime.includes('wordprocessingml')) {
      return { text: clip(extractDocx(buf)), meta: {}, note: null };
    }

    if (ext === 'xlsx' || mime.includes('spreadsheetml')) {
      return { text: clip(extractXlsx(buf)), meta: {}, note: null };
    }

    if (ext === 'doc' || ext === 'xls' || mime === 'application/msword' || mime === 'application/vnd.ms-excel') {
      // Eski ikkilik format: ichidan o'qiladigan matnni yig'amiz
      const text = extractLegacyBinary(buf);
      return {
        text: clip(text),
        meta: { legacy: true },
        note: 'Eski Office formati (.doc/.xls) — matn taxminiy ajratildi. Aniqroq natija uchun faylni .docx/.xlsx ko‘rinishida saqlang.',
      };
    }

    if (mime.startsWith('image/')) {
      return {
        text: '',
        meta: { image: true },
        note: 'Rasm fayli qabul qilindi. Serverda OCR yoqilmagan, shuning uchun rasm ichidagi matn o‘qilmaydi — rasmda nima borligini qisqacha yozib bering.',
      };
    }

    // Matnli formatlar: txt, md, csv, json, log ...
    const text = buf.toString('utf8');
    if (looksBinary(text)) throw new Error('Fayl matn ko‘rinishida emas');
    return { text: clip(text), meta: {}, note: null };
  } catch (err) {
    return { text: '', meta: { error: true }, note: `Fayl mazmunini o‘qib bo‘lmadi: ${err.message}` };
  }
}

/** .doc/.xls ichidan o'qiladigan matn bo'laklarini yig'ish (taxminiy). */
function extractLegacyBinary(buf) {
  const out = [];
  let current = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    const printable = (b >= 32 && b <= 126) || b === 10 || b === 13 || b === 9 || b >= 192;
    if (printable) {
      current += String.fromCharCode(b);
    } else {
      if (current.length >= 6) out.push(current);
      current = '';
    }
  }
  if (current.length >= 6) out.push(current);
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function looksBinary(text) {
  const sample = text.slice(0, 2000);
  let bad = 0;
  for (const ch of sample) {
    const c = ch.charCodeAt(0);
    if (c === 0 || (c < 9) || (c > 13 && c < 32)) bad++;
  }
  return bad / Math.max(sample.length, 1) > 0.05;
}

const clip = (s) => sanitizeText(String(s || '')).slice(0, MAX_TEXT);

/** Fayl mazmuni asosida qisqa xulosa (chat ro'yxatida ko'rsatish uchun). */
export function summarize(text, kind) {
  const t = String(text || '').trim();
  if (!t) return kind === 'image' ? 'Rasm fayli' : 'Matn ajratilmadi';
  const words = t.split(/\s+/).length;
  const first = t.split(/\n+/).find((l) => l.trim().length > 20) || t.slice(0, 80);
  return `${words} so‘z • ${first.slice(0, 90).trim()}${first.length > 90 ? '…' : ''}`;
}
