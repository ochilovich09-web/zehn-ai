import crypto from 'node:crypto';

/**
 * Fayl xavfsizligi tekshiruvi.
 *
 * Bu antivirus ORNINI BOSMAYDI. Bu — yuklangan faylni qabul qilishdan oldingi
 * dastlabki filtr: bajariladigan fayllar, makros, skript va boshqa xavfli
 * naqshlarni aniqlaydi. Ishlab chiqarishda ClamAV kabi skaner ulash uchun
 * `externalScanner` nuqtasi qoldirilgan.
 */

const EXECUTABLE_SIGNATURES = [
  { name: 'Windows PE (.exe/.dll)', hex: '4d5a' },
  { name: 'ELF binary', hex: '7f454c46' },
  { name: 'Mach-O binary', hex: 'cffaedfe' },
  { name: 'Java class', hex: 'cafebabe' },
  { name: 'Shell script', hex: '2321' },
];

const DANGEROUS_EXT = new Set([
  'exe', 'dll', 'bat', 'cmd', 'com', 'scr', 'pif', 'msi', 'vbs', 'js', 'jse', 'ws', 'wsf',
  'ps1', 'psm1', 'sh', 'jar', 'apk', 'app', 'deb', 'rpm', 'iso', 'lnk', 'reg', 'hta',
]);

/** Hujjat ichidagi xavfli naqshlar. */
const CONTENT_PATTERNS = [
  { rx: /vbaProject\.bin/i, level: 'warn', note: 'Hujjatda VBA makros mavjud' },
  { rx: /<script[\s>]/i, level: 'warn', note: 'Hujjatda <script> tegi bor' },
  { rx: /\/JavaScript\s*[(<]/i, level: 'block', note: 'PDF ichida JavaScript kodi' },
  { rx: /\/OpenAction/i, level: 'warn', note: 'PDF ochilganda avtomatik amal bajaradi' },
  { rx: /\/Launch\s*<</i, level: 'block', note: 'PDF tashqi dastur ishga tushirmoqchi' },
  { rx: /\/EmbeddedFile/i, level: 'warn', note: 'Hujjat ichiga boshqa fayl joylangan' },
  { rx: /powershell\s+-(enc|e|w hidden)/i, level: 'block', note: 'Yashirin PowerShell buyrug‘i' },
];

/** Prompt-injection urinishlari (fayl matni AI'ga uzatilishidan oldin). */
const INJECTION_PATTERNS = [
  /ignore (all )?(previous|above) instructions/i,
  /disregard (the )?(system|previous) (prompt|instructions)/i,
  /avvalgi (ko‘rsatma|buyruq)larni (unut|e[’']tiborsiz)/i,
  /забудь (все )?(предыдущие )?инструкции/i,
  /you are now (a |an )?(dan|developer mode)/i,
];

/**
 * @returns {{status:'clean'|'suspicious'|'blocked', notes:string[], sha256:string}}
 */
export function scanFile(buf, name = '', declaredMime = '') {
  const notes = [];
  let status = 'clean';

  const ext = (name.split('.').pop() || '').toLowerCase();
  const head = buf.subarray(0, 16).toString('hex').toLowerCase();
  const sample = buf.subarray(0, Math.min(buf.length, 512 * 1024)).toString('latin1');

  // 1) Kengaytma qora ro'yxati
  if (DANGEROUS_EXT.has(ext)) {
    notes.push(`Bajariladigan fayl turi (.${ext}) qabul qilinmaydi`);
    status = 'blocked';
  }

  // 2) Ikki kengaytmali hiyla: "hisobot.pdf.exe"
  const parts = name.toLowerCase().split('.');
  if (parts.length > 2 && DANGEROUS_EXT.has(parts.at(-1))) {
    notes.push('Fayl nomida ikkita kengaytma bor (yashirin bajariladigan fayl belgisi)');
    status = 'blocked';
  }

  // 3) Ikkilik imzo
  for (const sig of EXECUTABLE_SIGNATURES) {
    if (head.startsWith(sig.hex)) {
      notes.push(`Fayl imzosi bajariladigan faylga mos: ${sig.name}`);
      status = 'blocked';
    }
  }

  // 4) Deklaratsiya qilingan tur va haqiqiy imzo mos kelmasa
  if (declaredMime === 'application/pdf' && !buf.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
    notes.push('Fayl PDF deb belgilangan, lekin PDF imzosi yo‘q');
    status = status === 'blocked' ? status : 'suspicious';
  }

  // 5) Kontent naqshlari
  for (const p of CONTENT_PATTERNS) {
    if (p.rx.test(sample)) {
      notes.push(p.note);
      if (p.level === 'block') status = 'blocked';
      else if (status === 'clean') status = 'suspicious';
    }
  }

  // 6) Zip bomba belgisi (juda kichik arxiv, juda katta mazmun)
  if (head.startsWith('504b0304') && buf.length > 1024) {
    const declaredSize = totalUncompressed(buf);
    if (declaredSize && declaredSize / buf.length > 200) {
      notes.push('Arxiv siqilish nisbati juda yuqori (zip bomba xavfi)');
      status = 'blocked';
    }
  }

  return { status, notes, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

/** Fayl matnida AI'ga qaratilgan buyruq bormi? */
export function detectPromptInjection(text) {
  const found = INJECTION_PATTERNS.filter((rx) => rx.test(text));
  return {
    detected: found.length > 0,
    note: found.length
      ? 'Fayl ichida AI ko‘rsatmalarini o‘zgartirishga urinish topildi. Bunday matn oddiy ma’lumot sifatida ko‘riladi, buyruq sifatida bajarilmaydi.'
      : null,
  };
}

function totalUncompressed(buf) {
  try {
    let total = 0;
    let pos = 0;
    const sig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    while (pos < buf.length && total < Number.MAX_SAFE_INTEGER) {
      const at = buf.indexOf(sig, pos);
      if (at === -1 || at + 30 > buf.length) break;
      total += buf.readUInt32LE(at + 22);
      pos = at + 4;
    }
    return total;
  } catch { return 0; }
}

/**
 * Tashqi antivirus ulash nuqtasi (masalan ClamAV `clamd` yoki VirusTotal API).
 * Hozircha o'chirilgan — yoqilganda scanFile natijasiga qo'shiladi.
 */
export async function externalScanner(/* buf, name */) {
  return { enabled: false, status: 'skipped' };
}
