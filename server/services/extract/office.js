import { readZipEntries, extractZipFile, xmlToText, decodeEntities } from './zip.js';

/* ── DOCX ───────────────────────────────────────────────────────────── */
export function extractDocx(buf) {
  const entries = readZipEntries(buf);
  const parts = ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']
    .map((n) => extractZipFile(buf, entries, n))
    .filter(Boolean);
  if (!parts.length) throw new Error('DOCX: word/document.xml topilmadi');

  const text = parts.map((p) => xmlToText(p.toString('utf8'), {
    blockTags: ['</w:p>', '<w:br/>', '<w:br />'],
    tabTags: ['<w:tab/>', '<w:tab />'],
  })).join('\n');

  return normalize(text);
}

/* ── XLSX ───────────────────────────────────────────────────────────── */
export function extractXlsx(buf, { maxRows = 500 } = {}) {
  const entries = readZipEntries(buf);

  // 1) Umumiy satrlar jadvali (sharedStrings)
  const sharedRaw = extractZipFile(buf, entries, 'xl/sharedStrings.xml');
  const shared = [];
  if (sharedRaw) {
    const xml = sharedRaw.toString('utf8');
    for (const si of xml.split('<si>').slice(1)) {
      const texts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1]));
      shared.push(texts.join(''));
    }
  }

  // 2) Varaqlar
  const sheetFiles = [...entries.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  const titles = sheetTitles(buf, entries);
  const out = [];

  sheetFiles.forEach((sheetFile, idx) => {
    const raw = extractZipFile(buf, entries, sheetFile);
    if (!raw) return;
    const xml = raw.toString('utf8');
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].slice(0, maxRows);
    if (!rows.length) return;

    const table = rows.map((r) => {
      const cells = [...r[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>|<c\s([^>]*)\/>/g)];
      const line = [];
      for (const c of cells) {
        const attrs = c[1] || c[3] || '';
        const body = c[2] || '';
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const col = colIndex(/r="([A-Z]+)\d+"/.exec(attrs)?.[1] || '');
        let value = '';
        if (type === 's') {
          const i = Number.parseInt(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '', 10);
          value = Number.isFinite(i) ? shared[i] ?? '' : '';
        } else if (type === 'inlineStr') {
          value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1])).join('');
        } else {
          value = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
        }
        while (line.length < col) line.push('');
        line[col] = String(value).replace(/[\r\n]+/g, ' ').trim();
      }
      return line;
    });

    const title = titles[idx] || `Sheet${idx + 1}`;
    out.push(`### ${title}\n${table.map((r) => r.join(' | ')).join('\n')}`);
  });

  if (!out.length) throw new Error('XLSX: ma’lumot topilmadi');
  return normalize(out.join('\n\n'));
}

function sheetTitles(buf, entries) {
  const wb = extractZipFile(buf, entries, 'xl/workbook.xml');
  if (!wb) return [];
  return [...wb.toString('utf8').matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
}

/** "AB1" -> 27 (0 dan boshlab) */
function colIndex(ref) {
  const letters = ref.replace(/[^A-Z]/g, '');
  if (!letters) return 0;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const NUL = String.fromCharCode(0);
const NBSP = String.fromCharCode(160);

const normalize = (s) => s
  .split(NUL).join('')
  .split(NBSP).join(' ')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
