# Zehn AI — Universal AI Assistant Platform

Ko'p sohali AI yordamchi platformasi: savolni tahlil qiladi, muammoni qismlarga ajratadi,
yechim yo'llarini taqqoslaydi va amaliy qadamlar beradi.

**Nol tashqi kutubxona.** `npm install` shart emas — faqat Node.js 22.5+ kerak.

---

## Ishga tushirish

```bash
node server/index.js
```

Brauzerda oching: <http://127.0.0.1:3000>

Birinchi ishga tushirishda `data/app.db` (SQLite) avtomatik yaratiladi.

### AI provayderi

Platforma **ikkita provayder** bilan ishlaydi va kalit ko'rinishidan turini o'zi aniqlaydi:

```bash
# .env — Google Gemini (AQ.… yoki AIza… bilan boshlanadi)
GEMINI_API_KEY=AQ...
AI_MODEL=gemini-3.5-flash

# yoki Anthropic (sk-ant-… bilan boshlanadi)
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-sonnet-5
```

Kalitni noto'g'ri maydonga qo'ysangiz ham server prefiksdan tanib oladi.
Majburlash kerak bo'lsa: `AI_PROVIDER=gemini` yoki `anthropic`.

Kalitsiz platforma **Local Reasoning Engine** rejimida ishlaydi — tahlil, tuzilma va
matematik hisob haqiqiy, lekin keng bilim bazasi ulanmagan. Provayder javob bermay
qolsa ham shu rejimga avtomatik o'tadi, foydalanuvchi javobsiz qolmaydi.

> **Gemini haqida:** 3.x modellari javobdan oldin "o'ylaydi" va fikrlash tokenlari
> `maxOutputTokens` ichidan hisoblanadi. `gemini.js` da limitga zaxira qo'shilgan
> va `thinkingLevel: low` o'rnatilgan — aks holda javob matni bo'sh qaytishi mumkin.

---

## Imkoniyatlar

| Bo'lim | Tafsilot |
|---|---|
| **AI pipeline** | `CONTEXT ANALYSIS → PROBLEM DETECTION → REASONING → SOLUTION → ACTION STEPS`, har bosqich interfeysda ko'rinadi |
| **13 ta soha** | dasturlash, matematika, biznes, ta'lim, hujjatlar, rejalashtirish, texnik yordam, ijod, loyiha, shaxsiy, texnologiya, kundalik, umumiy |
| **Til** | UZ / RU / EN — interfeys va AI javobi alohida aniqlanadi |
| **Ovoz** | Mikrofon → matn (Web Speech API), javobni ovozda o'qish (SpeechSynthesis) |
| **Fayllar** | PDF, DOCX, XLSX, DOC, XLS, TXT, CSV, JSON, rasm — matn ajratib, mazmuni bo'yicha javob |
| **Chat** | Rename, delete, archive, pin, qidiruv, kun bo'yicha guruhlash, markdown + kod bloklari |
| **Akkaunt** | Ro'yxatdan o'tish, kirish, email tasdiqlash, parol tiklash, sessiya boshqaruvi |
| **Mavzu** | Yorug' / qorong'i / tizim |

---

## Arxitektura

```
server/
  index.js              HTTP server, statik fayllar, xavfsizlik sarlavhalari (CSP)
  config.js             .env o'quvchi, sozlamalar
  lib/
    db.js               SQLite sxema + repozitoriylar (node:sqlite)
    crypto.js           scrypt parol, HMAC JWT, tasodifiy tokenlar
    auth.js             access/refresh token, cookie, requireAuth
    router.js           yengil router (`/api/chats/:id`)
    multipart.js        multipart/form-data parser
    ratelimit.js        sliding-window limiter + brute-force himoya
    validate.js         kirish tekshiruvi, fayl nomi tozalash
    http.js             JSON javob, xatolar, SSE kanali
  routes/               auth · chat · files · user
  services/
    ai/
      classify.js       til / soha / maqsad / murakkablik / noaniqlik tahlili
      prompts.js        3 tilda system prompt quruvchi
      anthropic.js      Anthropic Messages API (streaming)
      gemini.js         Google Gemini API (streaming, thinking-aware)
      local.js          offline reasoning engine (playbook + fayl tahlili)
      mathkit.js        xavfsiz ifoda hisoblagich + chiziqli tenglama yechuvchi
      engine.js         pipeline orkestratori
    extract/            pdf.js · office.js (docx/xlsx) · zip.js · index.js
    security/scan.js    fayl imzosi, makros, zip-bomba, prompt-injection tekshiruvi
public/
  css/                  tokens (mavzu) · base · components · app
  js/core/              api (token yangilash, SSE) · store · i18n · dom
  js/ui/                auth · sidebar · chat · composer · voice · settings · markdown · highlight · toast
```

### Nega tashqi kutubxona yo'q

| Odatda kerak bo'ladi | Bu yerda |
|---|---|
| express | `node:http` + 60 qatorli router |
| better-sqlite3 | `node:sqlite` (Node 22.5+ ichida) |
| bcrypt | `node:crypto` scrypt |
| jsonwebtoken | HMAC-SHA256 bilan o'z JWT'imiz |
| multer | o'z multipart parserimiz |
| pdf-parse | `node:zlib` + PDF kontent oqimi o'quvchi |
| mammoth / xlsx | ZIP (`inflateRaw`) + XML o'quvchi |
| marked + highlight.js | o'z markdown renderer va bo'yoqchimiz |

---

## Xavfsizlik

- Parollar **scrypt** (N=16384) + tasodifiy tuz bilan saqlanadi
- Access token 15 daqiqa, refresh token httpOnly cookie'da, har yangilashda **rotatsiya**
- Login uchun brute-force himoyasi (5 urinishdan keyin progressiv bloklash)
- Fayllar: imzo (magic bytes) tekshiruvi, bajariladigan fayllar bloklanadi, makros/JS
  aniqlanadi, zip-bomba nisbati tekshiriladi, nomi tasodifiylashtirilib saqlanadi
- Fayl ichidagi "AI ko'rsatmalari" (prompt injection) aniqlanadi va foydalanuvchiga
  ogohlantirish ko'rsatiladi — matn buyruq sifatida bajarilmaydi
- CSP, X-Frame-Options, nosniff, Permissions-Policy sarlavhalari
- Markdown XSS'ga qarshi: kirish to'liq ekranlanadi, faqat oq ro'yxatdagi teglar qo'yiladi

---

## API

| Metod | Yo'l | Tavsif |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/refresh` · `/logout` | Autentifikatsiya |
| POST | `/api/auth/forgot-password` · `/reset-password` · `/verify-email` | Parol va email |
| GET | `/api/auth/sessions` | Faol sessiyalar |
| GET/POST | `/api/chat/chats` | Suhbatlar ro'yxati / yaratish |
| POST | `/api/chat/chats/:id/messages` | Xabar yuborish → **SSE oqimi** |
| POST | `/api/chat/chats/:id/regenerate` | Javobni qayta generatsiya |
| POST | `/api/files/upload` | Fayl yuklash (skanerlash + matn ajratish) |
| PATCH | `/api/user/profile` | Profil, til, mavzu, bildirishnoma |
| GET | `/api/user/export` | Barcha ma'lumotlarni JSON'da yuklab olish |

### SSE hodisalari

`user_message` · `stage` · `analysis` · `warning` · `delta` · `title` · `done` · `error`

---

## Sinov fayllari

`tests/fixtures/` ichida PDF, DOCX, XLSX va CSV namunalari bor — fayl tahlilini
sinab ko'rish uchun chatga biriktiring.

---

## Dizayn

Interfeys Google Stitch'da yaratilgan maket asosida qurilgan.
Promptlar va dizayn tizimi: [`stitch-prompt.md`](stitch-prompt.md)

| Token | Qorong'i | Yorug' |
|---|---|---|
| Fon | `#0B0D12` | `#F7F8FB` |
| Sidebar | `#10141D` | `#FFFFFF` |
| Sirt / kartochka | `#141821` | `#FFFFFF` |
| Foydalanuvchi pufakchasi | `#1E2533` | `#F2F4F9` |
| Chegara | `#232833` | `#E3E8F0` |
| Accent | `#6366F1` (indigo) + `#22D3EE` (cyan) | |
| Shrift | Inter (matn) · JetBrains Mono (kod) | |

Barcha qiymatlar `public/css/tokens.css` da — bitta joyda o'zgartirsangiz,
butun interfeys moslashadi. Shriftlar Google Fonts'dan yuklanadi; internet
bo'lmasa tizim shriftiga qaytadi.
# zehn-ai
