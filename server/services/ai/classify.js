/**
 * CONTEXT ANALYSIS + PROBLEM DETECTION bosqichi.
 * Bu modul foydalanuvchi savolini javob yozilishidan OLDIN tahlil qiladi:
 * til, soha, maqsad (intent), murakkablik, noaniqlik va yetishmayotgan ma'lumot.
 */

/* ── 1. Til aniqlash ────────────────────────────────────────────────── */
const STOPWORDS = {
  ru: ['что', 'как', 'почему', 'это', 'мне', 'нужно', 'помоги', 'сделать', 'можно', 'если', 'для', 'меня',
    'или', 'не', 'на', 'в', 'и', 'мой', 'моя', 'есть', 'был', 'будет', 'хочу', 'можешь', 'пожалуйста'],
  uz: ['nima', 'qanday', 'qanaqa', 'kerak', 'uchun', 'bilan', 'menga', 'yordam', 'qilish', 'lekin', 'yoki',
    'qaysi', 'nega', 'iltimos', 'men', 'sen', 'siz', 'bu', 'shu', 'ham', 'edi', 'boshqa', 'juda', 'yana'],
  en: ['what', 'how', 'why', 'the', 'need', 'help', 'should', 'could', 'please', 'with', 'about', 'make',
    'from', 'this', 'that', 'and', 'for', 'you', 'me', 'my', 'is', 'are', 'can', 'want', 'write', 'give'],
};

/** Natija: { lang, confidence } — ishonch past bo‘lsa chaqiruvchi fallback ishlatadi. */
export function detectLanguage(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const tokens = lower.split(/[^\p{L}\p{N}‘’ʻ]+/u).filter(Boolean);
  if (!tokens.length) return { lang: null, confidence: 0 };

  const cyrillic = (lower.match(/[Ѐ-ӿ]/g) || []).length;
  const latin = (lower.match(/[a-z]/g) || []).length;

  const score = { uz: 0, ru: 0, en: 0 };
  if (cyrillic > latin && cyrillic > 3) score.ru += 8;

  const sets = { ru: new Set(STOPWORDS.ru), uz: new Set(STOPWORDS.uz), en: new Set(STOPWORDS.en) };
  for (const tok of tokens) {
    for (const lang of ['ru', 'uz', 'en']) if (sets[lang].has(tok)) score[lang] += 2.5;
  }

  // O‘zbek tiliga xos morfologiya va belgilar
  if (/[‘’ʻ]/.test(raw) && latin > 0) score.uz += 3;
  if (/(moqchi|yapman|yapti|ganman|gandan|larni|ining|dagi|sizga|ishlamay|kerakmi)/.test(lower)) score.uz += 4;
  // Ingliz tiliga xos qo‘shimchalar
  if (/\b\w+(tion|ment|ness|able|ing)\b/.test(lower)) score.en += 2;
  if (cyrillic === 0) score.ru = 0;

  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [lang, best] = ranked[0];
  const total = ranked.reduce((s, [, x]) => s + x, 0) || 1;
  if (best < 2.5) return { lang: cyrillic > 0 ? 'ru' : null, confidence: cyrillic > 0 ? 0.7 : 0 };
  return { lang, confidence: Math.min(0.99, best / total) };
}

/* ── 2. Soha (domain) klassifikatori ────────────────────────────────── */
/** Har bir soha uchun 3 tilda kalit so'zlar. */
export const DOMAINS = {
  programming: {
    icon: 'code', weight: 1.15,
    kw: ['kod', 'dastur', 'funksiya', 'xato', 'bug', 'debug', 'api', 'massiv', 'o‘zgaruvchi', 'sikl', 'kutubxona', 'framework',
      'код', 'программ', 'функци', 'ошибк', 'массив', 'переменн', 'цикл', 'библиотек',
      'code', 'function', 'error', 'bug', 'array', 'variable', 'loop', 'library', 'compile', 'deploy', 'git', 'commit',
      'javascript', 'python', 'java', 'react', 'node', 'sql', 'html', 'css', 'php', 'typescript', 'docker', 'regex'],
  },
  math: {
    icon: 'sigma', weight: 1.2,
    kw: ['matematik', 'tenglama', 'hisobla', 'foiz', 'formul', 'integral', 'hosila', 'geometri', 'ehtimol', 'grafik',
      'математик', 'уравнени', 'вычисл', 'процент', 'формул', 'интеграл', 'производн', 'вероятност',
      'math', 'equation', 'calculate', 'percent', 'formula', 'integral', 'derivative', 'probability', 'solve for'],
  },
  technology: {
    icon: 'cpu', weight: 1.0,
    kw: ['texnologiya', 'kompyuter', 'server', 'tarmoq', 'internet', 'qurilma', 'protsessor', 'xotira', 'bulut',
      'технологи', 'компьютер', 'сервер', 'сеть', 'устройств', 'процессор', 'память', 'облак',
      'technology', 'computer', 'server', 'network', 'device', 'processor', 'memory', 'cloud', 'hardware'],
  },
  education: {
    icon: 'graduation', weight: 1.05,
    kw: ['o‘qish', 'o‘rgan', 'dars', 'universitet', 'maktab', 'imtihon', 'talaba', 'kurs', 'tushuntir', 'mavzu', 'referat',
      'учить', 'изучи', 'урок', 'университет', 'школ', 'экзамен', 'студент', 'курс', 'объясни', 'тема',
      'learn', 'study', 'lesson', 'university', 'school', 'exam', 'student', 'course', 'explain', 'teach', 'homework'],
  },
  business: {
    icon: 'briefcase', weight: 1.1,
    kw: ['biznes', 'startap', 'foyda', 'daromad', 'mijoz', 'bozor', 'marketing', 'sotuv', 'investor', 'raqobat',
      'tadbirkor', 'tannarx', 'ijara', 'kafe', 'kofexona', 'do‘kon', 'restoran', 'franshiza', 'byudjet',
      'ochmoqchi', 'sotmoqchi', 'xizmat ko‘rsat', 'mahsulot', 'narx',
      'бизнес', 'стартап', 'прибыл', 'доход', 'клиент', 'рынок', 'маркетинг', 'продаж', 'инвестор', 'конкурент',
      'предприним', 'выручк', 'себестоимост', 'франшиз', 'кофейн', 'кафе', 'ресторан', 'аренд', 'открыть свое',
      'бюджет', 'товар', 'услуг', 'цена',
      'business', 'startup', 'profit', 'revenue', 'customer', 'market', 'marketing', 'sales', 'investor',
      'pricing', 'budget', 'coffee shop', 'shop', 'product'],
  },
  work_project: {
    icon: 'kanban', weight: 1.0,
    kw: ['loyiha', 'jamoa', 'topshiriq', 'deadline', 'muddat', 'hisobot', 'ish', 'vazifa', 'menejer', 'sprint',
      'проект', 'команд', 'задач', 'дедлайн', 'срок', 'отчет', 'работ', 'менеджер', 'спринт',
      'project', 'team', 'task', 'deadline', 'report', 'work', 'manager', 'sprint', 'milestone', 'roadmap'],
  },
  planning: {
    icon: 'calendar', weight: 1.0,
    kw: ['reja', 'rejalashtir', 'jadval', 'maqsad', 'bosqich', 'strategiya', 'kun tartibi', 'oy', 'yil',
      'план', 'планир', 'график', 'цель', 'этап', 'стратеги', 'распорядок',
      'plan', 'planning', 'schedule', 'goal', 'stage', 'strategy', 'roadmap', 'timeline', 'agenda'],
  },
  personal: {
    icon: 'user', weight: 0.95,
    kw: ['shaxsiy', 'odat', 'motivatsiya', 'vaqt boshqaruvi', 'sog‘lik', 'uyqu', 'sport', 'oila', 'do‘st',
      'личн', 'привычк', 'мотиваци', 'здоров', 'сон', 'спорт', 'семь',
      'personal', 'habit', 'motivation', 'time management', 'health', 'sleep', 'family', 'routine'],
  },
  documents: {
    icon: 'file-text', weight: 1.1,
    kw: ['hujjat', 'ariza', 'shartnoma', 'rezyume', 'cv', 'xat', 'bayonnoma', 'tahrir', 'matn yoz', 'tarjima',
      'документ', 'заявлени', 'договор', 'резюме', 'письмо', 'протокол', 'редактир', 'перевод',
      'document', 'contract', 'resume', 'cover letter', 'letter', 'draft', 'proofread', 'translate', 'template'],
  },
  technical_support: {
    icon: 'wrench', weight: 1.15,
    kw: ['ishlamayapti', 'muammo', 'nosozlik', 'tuzat', 'o‘chib qoldi', 'sekin ishlayapti', 'qotib qoldi', 'ochilmayapti',
      'не работает', 'не включ', 'не запуск', 'не открыва', 'проблем', 'неисправ', 'почини', 'зависает',
      'тормозит', 'сломал', 'глючит', 'выключается', 'перестал',
      'not working', 'broken', 'issue', 'fix', 'crash', 'freeze', 'slow', 'won’t start', 'troubleshoot'],
  },
  creative: {
    icon: 'sparkles', weight: 1.0,
    kw: ['ijod', 'g‘oya ber', 'nom o‘ylab', 'ssenariy', 'she’r', 'hikoya', 'dizayn', 'slogan', 'kontent',
      'творч', 'иде', 'придума', 'сценари', 'стих', 'истори', 'дизайн', 'слоган', 'контент',
      'creative', 'idea', 'brainstorm', 'name for', 'script', 'poem', 'story', 'design', 'slogan', 'content'],
  },
  daily: {
    icon: 'sun', weight: 0.9,
    kw: ['bugun', 'ertaga', 'ovqat', 'retsept', 'xarid', 'ob-havo', 'safar', 'transport', 'do‘kon',
      'сегодня', 'завтра', 'еда', 'рецепт', 'покупк', 'погод', 'поездк', 'транспорт', 'магазин',
      'today', 'tomorrow', 'food', 'recipe', 'shopping', 'weather', 'trip', 'transport', 'store'],
  },
  general: { icon: 'globe', weight: 0.6, kw: [] },
};

/**
 * Kalit so'z mosligi — uch xil qoida:
 *  1. Uzun element (> 4 belgi) — o'zak sifatida qaraladi: "программ" -> "программист".
 *  2. Qisqa element — so'z BOSHIDAN mos kelishi kifoya: "odat" -> "odatini"
 *     (o'zbek va rus tillari qo'shimchali, shuning uchun bu muhim).
 *  3. EXACT_ONLY ro'yxatidagilar faqat butun so'z sifatida: "bug" so'zi
 *     "bugun" ichidan topilmasligi kerak.
 */
const EXACT_ONLY = new Set(['bug', 'api', 'git', 'sql', 'css', 'php', 'ish', 'oy', 'yil', 'cv', 'vs', 'xat', 'son', 'shop']);

const kwCache = new Map();
export function hasKeyword(text, kw) {
  if (kw.length > 4) return text.includes(kw);

  let rx = kwCache.get(kw);
  if (!rx) {
    const escaped = [...kw].map((c) => (/[\p{L}\p{N}]/u.test(c) ? c : '\\' + c)).join('');
    const tail = EXACT_ONLY.has(kw) ? '([^\\p{L}\\p{N}]|$)' : '';
    rx = new RegExp('(^|[^\\p{L}\\p{N}])' + escaped + tail, 'u');
    kwCache.set(kw, rx);
  }
  return rx.test(text);
}

export function detectDomain(text, { attachments = [] } = {}) {
  const t = String(text).toLowerCase();
  const scores = [];

  for (const [name, def] of Object.entries(DOMAINS)) {
    let score = 0;
    const signals = [];
    for (const k of def.kw) {
      if (hasKeyword(t, k)) { score += k.length > 6 ? 2 : 1.4; signals.push(k); }
    }
    if (score > 0) scores.push({ domain: name, score: score * def.weight, signals: signals.slice(0, 6) });
  }

  // Kod bloki yoki stack-trace bo'lsa — dasturlash sohasi kuchayadi
  if (/```|function\s|=>|;\s*$|SELECT\s|<\/?[a-z]+>|Traceback|Exception|error:/im.test(text)) {
    const p = scores.find((s) => s.domain === 'programming');
    if (p) { p.score += 6; p.signals.unshift('code-block'); }
    else scores.push({ domain: 'programming', score: 6, signals: ['code-block'] });
  }
  // Matematik ifoda
  if (/\d+\s*[-+*/^=]\s*\d+|\b\d+%|\bx\s*=|∫|√/.test(text)) {
    const p = scores.find((s) => s.domain === 'math');
    if (p) { p.score += 3; p.signals.unshift('formula'); }
    else scores.push({ domain: 'math', score: 3, signals: ['formula'] });
  }
  // Fayl biriktirilgan bo'lsa
  if (attachments.length) {
    const kindMap = { spreadsheet: 'math', document: 'documents', data: 'business', text: 'documents', image: 'general' };
    for (const a of attachments) {
      const d = kindMap[a.kind] || 'documents';
      const p = scores.find((s) => s.domain === d);
      if (p) { p.score += 2.5; p.signals.unshift('attachment'); }
      else scores.push({ domain: d, score: 2.5, signals: ['attachment'] });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  if (!top || top.score < 1.2) {
    return { primary: 'general', confidence: 0.35, alternates: [], signals: [] };
  }
  const total = scores.reduce((s, x) => s + x.score, 0);
  return {
    primary: top.domain,
    confidence: Math.min(0.98, Math.round((top.score / total) * 100) / 100 + 0.15),
    alternates: scores.slice(1, 3).map((s) => s.domain),
    signals: top.signals,
  };
}

/* ── 3. Maqsad (intent) ─────────────────────────────────────────────── */
const INTENTS = [
  ['debug',     ['xato', 'ishlamayapti', 'nega ishlamay', 'bug', 'error', 'ошибк', 'не работает', 'crash', 'fails', 'exception']],
  ['explain',   ['tushuntir', 'nima u', 'nima degani', 'farqi nima', 'объясни', 'что такое', 'в чем разница', 'explain', 'what is', 'difference between', 'how does']],
  ['howto',     ['qanday qil', 'qanday yoz', 'qadam', 'yo‘riqnoma', 'как сделать', 'как написать', 'инструкц', 'how to', 'steps to', 'guide']],
  ['create',    ['yoz', 'yarat', 'tuz', 'generat', 'ishlab chiq', 'напиш', 'созда', 'состав', 'сделай', 'write', 'create', 'generate', 'build', 'make me']],
  ['compare',   ['taqqosla', 'qaysi biri', 'yaxshiroq', 'сравни', 'что лучше', 'compare', 'vs', 'which is better', 'pros and cons']],
  ['summarize', ['qisqacha', 'xulosa', 'umumlashtir', 'краткое', 'резюмируй', 'summarize', 'tl;dr', 'key points']],
  ['analyze',   ['tahlil', 'baholab ber', 'ko‘rib chiq', 'проанализ', 'оцени', 'analyze', 'review', 'evaluate', 'audit']],
  ['plan',      ['reja tuz', 'rejalashtir', 'jadval tuz', 'составь план', 'спланируй', 'plan for', 'roadmap', 'schedule for']],
  ['translate', ['tarjima', 'переведи', 'translate']],
  ['decide',    ['maslahat ber', 'nima qilay', 'tanla', 'посоветуй', 'помоги выбрать', 'что мне делать', 'should i', 'recommend', 'advise']],
];

export function detectIntent(text) {
  const t = String(text).toLowerCase();
  const found = [];
  for (const [intent, kws] of INTENTS) {
    const hits = kws.filter((k) => hasKeyword(t, k)).length;
    if (hits) found.push({ intent, hits });
  }
  found.sort((a, b) => b.hits - a.hits);
  if (found.length) return found[0].intent;
  if (/\?|\bmi\b|\bmi\?|ли\b/.test(t)) return 'question';
  return 'question';
}

/* ── 4. Murakkablik va noaniqlik ────────────────────────────────────── */
export function assessComplexity(text, { attachments = [], historyLength = 0 } = {}) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  let score = 0;
  if (words > 25) score += 1;
  if (words > 80) score += 1;
  if (/```/.test(text)) score += 1;
  if (attachments.length) score += 1;
  if (/(va|hamda|keyin|so‘ng|и|затем|and then|also)/i.test(text) && words > 20) score += 1;
  if (historyLength > 6) score += 1;
  if (score >= 4) return 'complex';
  if (score >= 2) return 'moderate';
  return 'simple';
}

/**
 * Noaniqlikni baholash: javob berishdan oldin aniqlashtiruvchi savol
 * kerakmi yoki yo'q. Har bir soha uchun "yetishmayotgan slot"lar bor.
 */
const REQUIRED_SLOTS = {
  programming: [
    { slot: 'language', rx: /(javascript|python|java\b|c\+\+|c#|php|go\b|rust|typescript|sql|html|css|node|react|vue|kotlin|swift|dart)/i,
      ask: { uz: 'Qaysi dasturlash tili/freymvork?', ru: 'Какой язык или фреймворк?', en: 'Which language or framework?' } },
    { slot: 'error_text', rx: /(error|exception|traceback|xato|ошибк|```)/i, onlyFor: ['debug'],
      ask: { uz: 'Xatolik matnini (to‘liq) yuboring', ru: 'Пришлите полный текст ошибки', en: 'Share the full error message' } },
  ],
  business: [
    { slot: 'market', rx: /(bozor|mijoz|auditoriy|рынок|клиент|аудитор|market|customer|audience|niche)/i,
      ask: { uz: 'Maqsadli bozor yoki mijoz kim?', ru: 'Кто целевой клиент или рынок?', en: 'Who is the target customer or market?' } },
    { slot: 'budget', rx: /(byudjet|mablag|som|\$|бюджет|budget|capital|investment)/i,
      ask: { uz: 'Boshlang‘ich byudjet qancha?', ru: 'Какой стартовый бюджет?', en: 'What is the starting budget?' } },
  ],
  planning: [
    { slot: 'timeframe', rx: /(kun|hafta|oy|yil|soat|день|недел|месяц|год|day|week|month|year|hour)/i,
      ask: { uz: 'Muddat qancha (kun/hafta/oy)?', ru: 'Какой срок (дни/недели/месяцы)?', en: 'What is the timeframe?' } },
    { slot: 'goal', rx: /(maqsad|natija|цель|результат|goal|outcome|target)/i,
      ask: { uz: 'Yakuniy maqsad nima?', ru: 'Какая конечная цель?', en: 'What is the end goal?' } },
  ],
  technical_support: [
    { slot: 'device_os', rx: /(windows|mac|linux|android|ios|telefon|noutbuk|kompyuter|телефон|ноутбук|phone|laptop)/i,
      ask: { uz: 'Qanday qurilma va OS?', ru: 'Какое устройство и ОС?', en: 'Which device and OS?' } },
    { slot: 'when_started', rx: /(qachon|kecha|bugun|keyin|когда|вчера|сегодня|after|since|yesterday)/i,
      ask: { uz: 'Muammo qachondan boshlandi?', ru: 'Когда началась проблема?', en: 'When did it start?' } },
  ],
  documents: [
    { slot: 'audience', rx: /(kimga|rahbar|mijoz|hr|кому|руководител|клиент|for my boss|to whom|recipient|hiring)/i,
      ask: { uz: 'Hujjat kimga mo‘ljallangan?', ru: 'Кому адресован документ?', en: 'Who is the document for?' } },
  ],
  education: [
    { slot: 'level', rx: /(boshlang|o‘rta|yuqori|maktab|universitet|kurs|начальн|средн|школ|универ|beginner|intermediate|advanced|grade)/i,
      ask: { uz: 'Bilim darajangiz qanday (boshlang‘ich/o‘rta/yuqori)?', ru: 'Какой у вас уровень?', en: 'What is your current level?' } },
  ],
};

export function assessAmbiguity(text, domain, intent, lang, { attachments = [], historyLength = 0 } = {}) {
  const t = String(text);
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  const missing = [];

  for (const req of REQUIRED_SLOTS[domain] || []) {
    if (req.onlyFor && !req.onlyFor.includes(intent)) continue;
    if (!req.rx.test(t)) missing.push({ slot: req.slot, question: req.ask[lang] || req.ask.en });
  }

  // Juda qisqa va umumiy so'rov
  const vague = words <= 4 && !/```/.test(t) && !attachments.length;
  let score = missing.length * 0.28 + (vague ? 0.4 : 0);
  if (historyLength > 0) score -= 0.2;          // kontekst bor — kamroq savol
  if (attachments.length) score -= 0.15;
  score = Math.max(0, Math.min(1, score));

  return {
    score: Math.round(score * 100) / 100,
    missing: missing.slice(0, 3),
    // Faqat haqiqatan zarur bo'lganda savol beramiz (foydalanuvchini charchatmaslik uchun)
    shouldAsk: score >= 0.55 && missing.length >= 2,
  };
}

/* ── 5. To'liq tahlil ───────────────────────────────────────────────── */
export function analyze(text, { attachments = [], history = [], userLanguage = 'uz' } = {}) {
  // Xabar tilini aniqlaymiz; ishonch past bo‘lsa foydalanuvchi profilidagi tilga qaytamiz.
  const detected = detectLanguage(text);
  const language = detected.lang && detected.confidence >= 0.4 ? detected.lang : userLanguage;
  const domain = detectDomain(text, { attachments });
  const intent = detectIntent(text);
  const complexity = assessComplexity(text, { attachments, historyLength: history.length });
  const ambiguity = assessAmbiguity(text, domain.primary, intent, language, { attachments, historyLength: history.length });

  return {
    language,
    languageDetected: detected.lang,
    languageConfidence: Math.round(detected.confidence * 100) / 100,
    domain: domain.primary,
    domainConfidence: domain.confidence,
    domainAlternates: domain.alternates,
    signals: domain.signals,
    intent,
    complexity,
    ambiguity,
    attachments: attachments.map((a) => ({ name: a.name, kind: a.kind, size: a.size })),
    turnCount: history.length,
    at: Date.now(),
  };
}
