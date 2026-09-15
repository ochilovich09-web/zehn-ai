/**
 * Kichik, xavfsiz matematik yadro (eval() ISHLATILMAYDI).
 * Local engine matematik savollarga haqiqiy javob bera olishi uchun kerak.
 */

const OPS = {
  '+': { prec: 1, assoc: 'L', fn: (a, b) => a + b },
  '-': { prec: 1, assoc: 'L', fn: (a, b) => a - b },
  '*': { prec: 2, assoc: 'L', fn: (a, b) => a * b },
  '/': { prec: 2, assoc: 'L', fn: (a, b) => a / b },
  '%': { prec: 2, assoc: 'L', fn: (a, b) => a % b },
  '^': { prec: 3, assoc: 'R', fn: (a, b) => a ** b },
};

const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, exp: Math.exp,
};

export function tokenize(input) {
  const src = String(input)
    .replace(/,(\d)/g, '.$1')
    .replace(/[×∙·]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/√/g, 'sqrt');

  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let n = '';
      while (i < src.length && /[0-9.]/.test(src[i])) n += src[i++];
      tokens.push({ t: 'num', v: Number.parseFloat(n) });
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let w = '';
      while (i < src.length && /[a-zA-Z]/.test(src[i])) w += src[i++];
      const lower = w.toLowerCase();
      if (FUNCS[lower]) tokens.push({ t: 'func', v: lower });
      else if (lower === 'pi') tokens.push({ t: 'num', v: Math.PI });
      else if (lower === 'e') tokens.push({ t: 'num', v: Math.E });
      else tokens.push({ t: 'var', v: lower });
      continue;
    }
    if (OPS[c]) { tokens.push({ t: 'op', v: c }); i++; continue; }
    if (c === '(' || c === ')') { tokens.push({ t: c }); i++; continue; }
    return null; // noma'lum belgi -> ifoda emas
  }
  return tokens.length ? tokens : null;
}

/** Yashirin ko'paytirish: 2x -> 2*x, 3(x+1) -> 3*(x+1) */
function insertImplicitMul(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const cur = tokens[i], next = tokens[i + 1];
    out.push(cur);
    if (!next) break;
    const curEnds = cur.t === 'num' || cur.t === 'var' || cur.t === ')';
    const nextStarts = next.t === 'num' || next.t === 'var' || next.t === '(' || next.t === 'func';
    if (curEnds && nextStarts) out.push({ t: 'op', v: '*' });
  }
  return out;
}

/** Shunting-yard -> RPN */
function toRpn(tokens) {
  const out = [], stack = [];
  for (const tok of tokens) {
    if (tok.t === 'num' || tok.t === 'var') out.push(tok);
    else if (tok.t === 'func') stack.push(tok);
    else if (tok.t === 'op') {
      const o1 = OPS[tok.v];
      while (stack.length) {
        const top = stack.at(-1);
        if (top.t === 'op' && (OPS[top.v].prec > o1.prec || (OPS[top.v].prec === o1.prec && o1.assoc === 'L'))) out.push(stack.pop());
        else break;
      }
      stack.push(tok);
    } else if (tok.t === '(') stack.push(tok);
    else if (tok.t === ')') {
      while (stack.length && stack.at(-1).t !== '(') out.push(stack.pop());
      if (!stack.length) return null;
      stack.pop();
      if (stack.length && stack.at(-1).t === 'func') out.push(stack.pop());
    }
  }
  while (stack.length) {
    const top = stack.pop();
    if (top.t === '(') return null;
    out.push(top);
  }
  return out;
}

function evalRpn(rpn, vars = {}) {
  const st = [];
  for (const tok of rpn) {
    if (tok.t === 'num') st.push(tok.v);
    else if (tok.t === 'var') {
      if (!(tok.v in vars)) return null;
      st.push(vars[tok.v]);
    } else if (tok.t === 'func') {
      if (!st.length) return null;
      st.push(FUNCS[tok.v](st.pop()));
    } else if (tok.t === 'op') {
      if (st.length < 2) return null;
      const b = st.pop(), a = st.pop();
      st.push(OPS[tok.v].fn(a, b));
    }
  }
  return st.length === 1 && Number.isFinite(st[0]) ? st[0] : null;
}

/** Ifodani hisoblash. Noto'g'ri ifodada null qaytadi. */
export function evaluate(expr, vars = {}) {
  const tokens = tokenize(expr);
  if (!tokens) return null;
  // Unar minus: (-5) yoki boshidagi -x
  const fixed = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i], prev = tokens[i - 1];
    if (tok.t === 'op' && tok.v === '-' && (!prev || prev.t === 'op' || prev.t === '(')) {
      fixed.push({ t: 'num', v: 0 });
    }
    fixed.push(tok);
  }
  const rpn = toRpn(insertImplicitMul(fixed));
  if (!rpn) return null;
  const val = evalRpn(rpn, vars);
  return val;
}

/**
 * Chiziqli tenglamani yechadi: "2x + 5 = 17" -> x = 6
 * g(x) = chap - o'ng chiziqli deb qaraladi; a va b nuqtalar orqali topiladi.
 */
export function solveLinear(input) {
  const eq = String(input).replace(/\s+/g, '');
  const sides = eq.split('=');
  if (sides.length !== 2 || !sides[0] || !sides[1]) return null;

  const varName = (eq.match(/[a-z]/i) || ['x'])[0].toLowerCase();
  if (['s', 'q', 'r', 'v'].includes(varName) && !/[xyz]/i.test(eq)) return null;

  const g = (x) => {
    const l = evaluate(sides[0], { [varName]: x });
    const r = evaluate(sides[1], { [varName]: x });
    return l === null || r === null ? null : l - r;
  };

  const g0 = g(0), g1 = g(1), g2 = g(2);
  if (g0 === null || g1 === null || g2 === null) return null;

  const a = g1 - g0;
  // Chiziqlilik tekshiruvi: g(2) taxminan 2a + g0 bo'lishi kerak
  if (Math.abs(g2 - (2 * a + g0)) > 1e-9) return { nonLinear: true, variable: varName };
  if (Math.abs(a) < 1e-12) return { noSolution: Math.abs(g0) > 1e-12, infinite: Math.abs(g0) <= 1e-12, variable: varName };

  const x = -g0 / a;
  const check = g(x);
  return {
    variable: varName,
    value: x,
    steps: [
      `${sides[0]} = ${sides[1]}`,
      `Hamma hadlarni chap tomonga: (${sides[0]}) - (${sides[1]}) = 0`,
      `Chiziqli ko‘rinish: ${round(a)}·${varName} + ${round(g0)} = 0`,
      `${varName} = ${round(-g0)} / ${round(a)} = ${round(x)}`,
    ],
    verified: check !== null && Math.abs(check) < 1e-6,
  };
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/** Belgi shu o'rinda yakka turgan o'zgaruvchimi (masalan "2x" dagi x)? */
function isStandaloneVar(str, i) {
  if (!/[a-z]/i.test(str[i])) return false;
  const prev = str[i - 1] ?? ' ';
  const next = str[i + 1] ?? ' ';
  return !/[a-z]/i.test(prev) && !/[a-z]/i.test(next);
}

/**
 * Erkin matn ichidan tenglamani ajratib oladi:
 * "2x + 5 = 17 tenglamani yech" -> "2x + 5 = 17"
 */
export function extractEquation(text) {
  const t = String(text);
  const eq = t.indexOf('=');
  if (eq === -1) return null;
  const okChar = (i) => /[0-9+\-*/^(). ]/.test(t[i]) || isStandaloneVar(t, i);

  let l = eq - 1;
  while (l >= 0 && okChar(l)) l--;
  let r = eq + 1;
  while (r < t.length && okChar(r)) r++;

  const seg = t.slice(l + 1, r).trim();
  if (!/=/.test(seg) || !/\d/.test(seg)) return null;
  const [lhs, rhs] = seg.split('=');
  return lhs?.trim() && rhs?.trim() ? seg : null;
}

/** Matndan matematik so'rovni ajratib olish va yechish. */
export function trySolve(text) {
  const t = String(text);

  // 1) Foiz: "300 ning 20 foizi", "20% от 300", "20% of 300"
  const pct = t.match(/(\d[\d.,]*)\s*%\s*(?:of|от|dan)?\s*(\d[\d.,]*)/i)
    || t.match(/(\d[\d.,]*)\s*(?:ning|dan)\s*(\d[\d.,]*)\s*(?:foiz|%)/i);
  if (pct) {
    const [a, b] = [num(pct[1]), num(pct[2])];
    const isSecondBase = /%/.test(pct[0].split(/\s+/)[0]) || /of|от|dan/i.test(pct[0]);
    const base = isSecondBase ? b : a;
    const rate = isSecondBase ? a : b;
    return { type: 'percent', expression: `${rate}% × ${base}`, value: round((base * rate) / 100),
      steps: [`${base} × ${rate} / 100 = ${round((base * rate) / 100)}`] };
  }

  // 2) Tenglama
  const equation = extractEquation(t);
  if (equation) {
    const sol = solveLinear(equation);
    if (sol && sol.value !== undefined) return { type: 'equation', expression: equation, ...sol };
    if (sol?.nonLinear) return { type: 'equation_nonlinear', expression: equation, variable: sol.variable };
  }

  // 3) Oddiy arifmetika
  const arith = t.match(/(\d[\d.,]*\s*(?:[+\-*/^]\s*\d[\d.,]*\s*)+)/);
  if (arith && /[+\-*/^]/.test(arith[1])) {
    const value = evaluate(arith[1]);
    if (value !== null) return { type: 'arithmetic', expression: arith[1].trim(), value: round(value) };
  }

  return null;
}

const num = (s) => Number.parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
