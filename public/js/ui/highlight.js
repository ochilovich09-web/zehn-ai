/**
 * Yengil sintaksis bo'yoqchi (tashqi kutubxonasiz).
 *
 * Muhim: bo'yash BITTA o'tishda bajariladi — xom kod skanerlanadi va har bir
 * bo'lak chiqarilayotganda ekranlanadi (escape). Ketma-ket replace ishlatilsa,
 * regex o'zi qo'shgan <span> markupini qayta ishlab, kod buzilib ketadi.
 */
import { escapeHtml } from '../core/dom.js';

const KEYWORDS = {
  js: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'new', 'this',
    'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof',
    'instanceof', 'null', 'undefined', 'true', 'false', 'switch', 'case', 'break', 'continue', 'extends',
    'of', 'in', 'delete', 'void', 'yield', 'static', 'get', 'set'],
  py: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'class', 'import', 'from', 'as', 'try', 'except',
    'finally', 'raise', 'with', 'lambda', 'None', 'True', 'False', 'and', 'or', 'not', 'in', 'is', 'pass',
    'yield', 'global', 'async', 'await', 'self', 'print', 'break', 'continue', 'assert'],
  sql: ['select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'join', 'left', 'right',
    'inner', 'outer', 'on', 'group', 'order', 'by', 'having', 'limit', 'create', 'table', 'alter', 'drop',
    'index', 'primary', 'key', 'foreign', 'references', 'and', 'or', 'not', 'null', 'as', 'distinct'],
  sh: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'echo', 'export',
    'cd', 'ls', 'rm', 'cp', 'mv', 'mkdir', 'grep', 'cat', 'sudo', 'npm', 'node', 'git', 'curl'],
};

const ALIASES = {
  javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', node: 'js', json: 'js',
  python: 'py', py3: 'py',
  bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', sh: 'sh',
  html: 'html', xml: 'html', svg: 'html', vue: 'html',
  css: 'css', scss: 'css', less: 'css',
  sql: 'sql', mysql: 'sql', postgres: 'sql', postgresql: 'sql',
  js: 'js', py: 'py',
};

const span = (cls, text) => `<span class="tok-${cls}">${escapeHtml(text)}</span>`;

export function highlight(code, lang = '') {
  const kind = ALIASES[String(lang).toLowerCase()];
  if (!kind) return escapeHtml(code);
  if (kind === 'html') return highlightHtml(code);
  if (kind === 'css') return highlightCss(code);
  return highlightCode(code, kind);
}

/* ── C/JS/Python/SQL uslubidagi tillar ── */
function highlightCode(code, kind) {
  const keywords = new Set((KEYWORDS[kind] || KEYWORDS.js).map((k) => k.toLowerCase()));

  const comment = kind === 'py' || kind === 'sh'
    ? String.raw`#[^\n]*`
    : kind === 'sql'
      ? String.raw`--[^\n]*|\/\*[\s\S]*?\*\/`
      : String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`;

  const string = String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + '`(?:[^`\\\\]|\\\\.)*`';
  const number = String.raw`\b\d[\d._]*\b`;
  const ident = String.raw`[A-Za-z_$][\w$]*`;
  const operator = String.raw`[+\-*/%=<>!&|?:^~]+`;

  const rx = new RegExp(`(${comment})|(${string})|(${number})|(${ident})|(${operator})`, 'g');

  let out = '';
  let last = 0;
  let m;

  while ((m = rx.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    const [full, com, str, num, name, op] = m;

    if (com !== undefined) out += span('com', com);
    else if (str !== undefined) out += span('str', str);
    else if (num !== undefined) out += span('num', num);
    else if (op !== undefined) out += span('op', op);
    else if (name !== undefined) {
      if (keywords.has(name.toLowerCase())) out += span('key', name);
      else if (code[m.index + name.length] === '(') out += span('fn', name);
      else out += escapeHtml(name);
    }

    last = m.index + full.length;
  }

  return out + escapeHtml(code.slice(last));
}

/* ── HTML / XML ── */
function highlightHtml(code) {
  const rx = /(<!--[\s\S]*?-->)|(<\/?)([\w:-]+)|([\w:-]+)(=)("(?:[^"]*)"|'(?:[^']*)')/g;
  let out = '';
  let last = 0;
  let m;

  while ((m = rx.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    const [full, comment, bracket, tag, attr, eq, value] = m;

    if (comment !== undefined) out += span('com', comment);
    else if (tag !== undefined) out += escapeHtml(bracket) + span('tag', tag);
    else out += span('attr', attr) + escapeHtml(eq) + span('str', value);

    last = m.index + full.length;
  }
  return out + escapeHtml(code.slice(last));
}

/* ── CSS ── */
function highlightCss(code) {
  const rx = /(\/\*[\s\S]*?\*\/)|(@[\w-]+)|([\w-]+)(\s*:\s*)([^;{}\n]+)/g;
  let out = '';
  let last = 0;
  let m;

  while ((m = rx.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    const [full, comment, atRule, prop, colon, value] = m;

    if (comment !== undefined) out += span('com', comment);
    else if (atRule !== undefined) out += span('key', atRule);
    else out += span('attr', prop) + escapeHtml(colon) + span('str', value);

    last = m.index + full.length;
  }
  return out + escapeHtml(code.slice(last));
}
