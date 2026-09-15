import { badRequest, tooLarge } from './http.js';

/**
 * multipart/form-data parser (tashqi kutubxonasiz).
 * Natija: { fields: {name: value}, files: [{ field, filename, mime, data }] }
 */
export function parseMultipart(buffer, contentType, { maxSize = Infinity, maxFiles = 10 } = {}) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw badRequest('multipart boundary topilmadi');
  const boundary = (m[1] || m[2]).trim();

  const delim = Buffer.from(`--${boundary}`);
  const fields = Object.create(null);
  const files = [];

  let pos = buffer.indexOf(delim);
  if (pos === -1) throw badRequest('multipart tanasi buzilgan');
  pos += delim.length;

  while (pos < buffer.length) {
    // Yakuniy chegara: "--"
    if (buffer[pos] === 0x2d && buffer[pos + 1] === 0x2d) break;
    // CRLF dan keyin header blok boshlanadi
    while (pos < buffer.length && (buffer[pos] === 0x0d || buffer[pos] === 0x0a)) pos++;

    const headerEnd = buffer.indexOf('\r\n\r\n', pos, 'utf8');
    if (headerEnd === -1) break;
    const headerText = buffer.toString('utf8', pos, headerEnd);
    const bodyStart = headerEnd + 4;

    const next = buffer.indexOf(delim, bodyStart);
    if (next === -1) throw badRequest('multipart qismi tugallanmagan');
    let bodyEnd = next;
    if (buffer[bodyEnd - 1] === 0x0a) bodyEnd--;
    if (buffer[bodyEnd - 1] === 0x0d) bodyEnd--;

    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText)?.[1] || '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
    const mime = (/content-type:\s*([^\r\n;]+)/i.exec(headerText)?.[1] || '').trim().toLowerCase();

    if (name) {
      if (filename !== undefined) {
        if (filename !== '') {
          const data = buffer.subarray(bodyStart, bodyEnd);
          if (data.length > maxSize) throw tooLarge(`"${filename}" fayli hajmi limitdan katta`);
          if (files.length >= maxFiles) throw badRequest(`Bir vaqtda ${maxFiles} tadan ortiq fayl yuborib bo‘lmaydi`);
          files.push({ field: name, filename, mime: mime || 'application/octet-stream', data });
        }
      } else {
        fields[name] = buffer.toString('utf8', bodyStart, bodyEnd);
      }
    }

    pos = next + delim.length;
  }

  return { fields, files };
}

/** Fayl imzosi (magic bytes) orqali haqiqiy turni aniqlash. */
export function sniffMime(buf, declared = '') {
  const hex = buf.subarray(0, 12).toString('hex').toLowerCase();
  const ascii = buf.subarray(0, 8).toString('latin1');

  if (ascii.startsWith('%PDF-')) return 'application/pdf';
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('52494646') && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (hex.startsWith('d0cf11e0')) {
    // Eski OLE2 konteyner: .doc yoki .xls
    return declared.includes('excel') ? 'application/vnd.ms-excel' : 'application/msword';
  }
  if (hex.startsWith('504b0304')) {
    // ZIP konteyner: docx / xlsx / pptx — declared'ga tayanamiz
    if (declared.includes('spreadsheet')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (declared.includes('wordprocessing')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return declared || 'application/zip';
  }
  return declared || 'text/plain';
}
