/**
 * Markdown renderer (tashqi kutubxonasiz).
 * Qo'llab-quvvatlaydi: sarlavha, qalin/kursiv, ro'yxat, jadval, sitata,
 * havola, chiziq, inline kod va til belgilangan kod bloklari.
 *
 * XAVFSIZLIK: kirish matni HTML sifatida talqin qilinmaydi — avval to'liq
 * ekranlanadi (escape), so'ng faqat bizning teglarimiz qo'yiladi.
 */
import { escapeHtml } from '../core/dom.js';
import { highlight } from './highlight.js';

export function renderMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n/g, '\n');

  // 1) Kod bloklarini vaqtincha olib qo'yamiz (ichidagi belgilar buzilmasligi uchun)
  const blocks = [];
  const withoutCode = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push({ lang: lang.trim(), code: code.replace(/\n$/, '') });
    return `§BLOCK${blocks.length - 1}§`;
  });

  const html = renderBlocks(withoutCode);

  // 2) Kod bloklarini qaytaramiz
  return html.replace(/(?:<p>\s*)?§BLOCK(\d+)§(?:\s*<\/p>)?/g, (_, i) => codeBlockHtml(blocks[+i]));
}

/* ── Blok darajasi ── */
function renderBlocks(src) {
  const lines = src.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Bo'sh qator
    if (!line.trim()) { i++; continue; }

    // Kod blok o'rniga qo'yilgan belgi
    if (/^§BLOCK\d+§$/.test(line.trim())) { out.push(line.trim()); i++; continue; }

    // Sarlavha
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // Gorizontal chiziq
    if (/^\s*([-*_])\s*\1\s*\1[\s*_-]*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // Jadval
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const table = [];
      while (i < lines.length && lines[i].includes('|')) table.push(lines[i++]);
      out.push(tableHtml(table));
      continue;
    }

    // Sitata
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderBlocks(quote.join('\n'))}</blockquote>`);
      continue;
    }

    // Ro'yxat (raqamli yoki belgili, ichma-ich)
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        items.push(lines[i++]);
      }
      out.push(listHtml(items));
      continue;
    }

    // Oddiy paragraf
    const para = [];
    while (i < lines.length && lines[i].trim()
      && !/^(#{1,4}\s|\s*>|\s*([-*+]|\d+[.)])\s|§BLOCK)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    if (para.length) out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
    else i++;
  }

  return out.join('\n');
}

function listHtml(lines) {
  const ordered = /^\s*\d+[.)]\s+/.test(lines[0]);
  const items = [];
  let current = null;
  let baseIndent = null;

  for (const line of lines) {
    const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (m) {
      const indent = m[1].length;
      if (baseIndent === null) baseIndent = indent;
      if (indent > baseIndent + 1 && current) {
        current.children.push(line.slice(baseIndent + 2));
      } else {
        current = { text: m[3], children: [] };
        items.push(current);
      }
    } else if (current) {
      current.children.push(line.trim());
    }
  }

  const body = items.map((item) => {
    const nested = item.children.filter((c) => /^\s*([-*+]|\d+[.)])\s+/.test(c));
    const plain = item.children.filter((c) => !/^\s*([-*+]|\d+[.)])\s+/.test(c));
    let html = inline(item.text);
    if (plain.length) html += ' ' + inline(plain.join(' '));
    if (nested.length) html += listHtml(nested);
    return `<li>${html}</li>`;
  }).join('');

  return ordered ? `<ol>${body}</ol>` : `<ul>${body}</ul>`;
}

function tableHtml(rows) {
  const cells = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const header = cells(rows[0]);
  const aligns = cells(rows[1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
  const body = rows.slice(2).map(cells);

  const th = header.map((c, idx) => `<th style="text-align:${aligns[idx] || 'left'}">${inline(c)}</th>`).join('');
  const tr = body.map((row) =>
    `<tr>${row.map((c, idx) => `<td style="text-align:${aligns[idx] || 'left'}">${inline(c)}</td>`).join('')}</tr>`
  ).join('');

  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

/* ── Satr ichi ── */
function inline(src) {
  let s = escapeHtml(src);

  // Inline kod (birinchi bo'lib — ichidagi belgilar formatlanmasin)
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(code);
    return `¤C${codes.length - 1}¤`;
  });

  // Havola: [matn](url) — faqat http(s) ga ruxsat
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    if (!/^https?:\/\//i.test(url)) return label;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Qalin, kursiv, o'chirilgan
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Yalang'och havolalar
  s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

  return s.replace(/¤C(\d+)¤/g, (_, i) => `<code>${codes[+i]}</code>`);
}

function codeBlockHtml({ lang, code }) {
  const label = lang || 'text';
  return `<div class="code-block" data-code="${encodeURIComponent(code)}">
  <div class="code-block__head">
    <span class="code-block__lang">${escapeHtml(label)}</span>
    <button type="button" class="code-block__copy" data-copy-code>
      <i data-icon="copy"></i><span>Copy</span>
    </button>
  </div>
  <pre><code>${highlight(code, lang)}</code></pre>
</div>`;
}
