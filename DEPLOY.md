# Zehn AI — Deploy qo'llanmasi

## Ma'lumotlar bazasi: Turso

Baza **Turso**'da (bulutdagi libSQL/SQLite) turadi, shuning uchun foydalanuvchilar va
suhbatlar hosting qayta ishga tushsa ham, qayta deploy qilinsa ham saqlanib qoladi —
hostingda baza uchun disk ulash shart emas.

| Rejim | Qachon | Sozlama |
|---|---|---|
| **Turso** | Production | `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` |
| Lokal SQLite | Ishlab chiqish | Ikkalasi bo'sh — `data/app.db` ishlatiladi |

### Token olish

Turso panel → **Databases → `zehn`** → **Generate Token** (Read & Write).
Yoki CLI: `turso db tokens create zehn`

### Lokal kompyuterda sinash

`.env` faylida oxirgi ikki qatordagi `#` ni olib tashlab, tokenni qo'ying:

```
TURSO_DATABASE_URL=libsql://zehn-ochilovich09-web.aws-eu-west-1.turso.io
TURSO_AUTH_TOKEN=eyJ...
```

So'ng butun API'ni Turso ustida tekshiring (31 ta test, AI kalit sarflamaydi):

```bash
npm run test:turso
```

Test o'z hisobini yaratadi va oxirida o'chiradi.

> Lokal `data/app.db` dagi eski test hisoblari Turso'ga ko'chmaydi — Turso bo'sh bazadan boshlanadi.
> Jadvallar birinchi ishga tushishda avtomatik yaratiladi.

---

## Qayerga deploy qilish mumkin

Zehn AI doimiy ishlab turadigan Node.js server va AI javoblari **uzoq SSE oqimi** orqali keladi:

| Platforma | Mosmi | Sabab |
|---|---|---|
| **Railway** | ✅ **Tavsiya** | GitHub'dan avtomatik deploy, Dockerfile'ni taniydi |
| Render | ✅ | Baza Turso'da bo'lgani uchun bepul tarif ham ishlaydi. Faollik bo'lmasa uxlab qoladi — birinchi so'rov sekin |
| Fly.io | ✅ | CLI orqali boshqariladi |
| VPS (Hetzner, DigitalOcean, mahalliy hosting) | ✅ | To'liq nazorat, Docker bilan |
| Vercel / Netlify | ❌ | Serverless: uzoq AI oqimlari va fayl yuklash uziladi |

---

## Railway orqali (tavsiya etiladi)

### 1. Kodni GitHub'ga yuklang

`.gitignore` tayyor — `.env` (API kalit) va `data/` (baza) repoga **tushmaydi**.

```bash
git add .
git commit -m "Zehn AI platform"
git push origin main
```

Tekshirish: GitHub'da `.env` fayli **ko'rinmasligi** kerak.

### 2. JWT maxfiy kalitini yarating

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Chiqqan qatorni saqlab qo'ying — 3-qadamda kerak bo'ladi. Uni hech kimga bermang.

### 3. Railway'da loyiha yarating

1. <https://railway.com> → GitHub bilan kiring
2. **New Project → Deploy from GitHub repo** → `zehn-ai` ni tanlang
3. Railway `Dockerfile` ni o'zi topib, build qiladi

### 4. O'zgaruvchilarni kiriting

Service → **Variables** bo'limiga qo'shing:

| O'zgaruvchi | Qiymat |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | 2-qadamda yaratilgan qator |
| `TURSO_DATABASE_URL` | `libsql://zehn-ochilovich09-web.aws-eu-west-1.turso.io` |
| `TURSO_AUTH_TOKEN` | Turso tokeningiz |
| `GEMINI_API_KEY` | Gemini kalitingiz |
| `AI_PROVIDER` | `gemini` |
| `AI_MODEL` | `gemini-3.5-flash` |
| `ADMIN_EMAILS` | Admin panelga kiradigan email(lar), vergul bilan |
| `TIER_FREE_DAILY` | Free tarif: 24 soatdagi so'rovlar (standart `30`) |
| `TIER_PRO_DAILY` | Pro tarif (standart `300`) |
| `TIER_PREMIUM_DAILY` | Premium tarif (standart `0` = cheklovsiz) |

> ⚠️ Haqiqiy qiymatlarni **faqat Railway Variables** ga yozing — bu faylga emas.
> `DEPLOY.md` repoga tushadi va repo ochiq.

`HOST`, `PORT` va `DATA_DIR` Dockerfile ichida sozlangan — ularni qo'shish shart emas.

> Server quyidagi hollarda ataylab **ishga tushmaydi** va logda `[FATAL]` ko'rsatadi —
> bu xato emas, himoya:
> - `JWT_SECRET` yo'q yoki 32 belgidan qisqa
> - `TURSO_DATABASE_URL` bor, lekin `TURSO_AUTH_TOKEN` yo'q
> - Turso token yaroqsiz (baza jadvallarini yaratib bo'lmadi)

### 5. Disk (ixtiyoriy)

Baza Turso'da, shuning uchun disk **shart emas**.

Faqat bitta narsa diskda qoladi: foydalanuvchi yuklagan **asl fayllar** (PDF, Excel...).
Disk ulanmasa, qayta deploydan keyin ular o'chadi — lekin fayldan ajratilgan **matn Turso'da
saqlanadi**, shuning uchun suhbatlar va AI tahlili buzilmaydi. Faqat asl faylni qayta
yuklab olish imkoni yo'qoladi.

Asl fayllar ham saqlansin desangiz: Service → **Settings → Volumes → Add Volume**, mount path **`/data`**.

### 6. Domen oling

Service → **Settings → Networking → Generate Domain**

Sizga `https://zehn-ai-production-xxxx.up.railway.app` kabi manzil beriladi.

### 7. Tekshiring

```
https://SIZNING-DOMEN/api/health
```

Javob: `{"ok":true,"status":"up","db":"turso","ai":{"enabled":true,"model":"gemini-3.5-flash"}}`

`"db":"turso"` ekanini tekshiring — `"sqlite"` chiqsa, Turso o'zgaruvchilari qo'shilmagan.

Keyin saytni ochib, ro'yxatdan o'ting va savol yuboring.

**Yangilash:** `git push` qilsangiz, Railway o'zi qayta deploy qiladi. Ma'lumotlar Turso'da saqlanib qoladi.

---

## VPS'ga Docker bilan

```bash
git clone https://github.com/ochilovich09-web/zehn-ai.git && cd zehn-ai
docker build -t zehn-ai .
docker run -d --name zehn-ai --restart unless-stopped \
  -p 3000:3000 \
  -v zehn-data:/data \
  -e JWT_SECRET="..." \
  -e TURSO_DATABASE_URL="libsql://..." \
  -e TURSO_AUTH_TOKEN="..." \
  -e GEMINI_API_KEY="..." \
  -e AI_PROVIDER=gemini \
  zehn-ai
```

HTTPS uchun oldiga **Caddy** qo'ying (sertifikatni o'zi oladi):

```
zehn.sizningdomen.uz {
    reverse_proxy localhost:3000
}
```

HTTPS majburiy: productionda cookie `Secure` bayrog'i bilan yuboriladi va mikrofon
(ovozli kiritish) brauzerda faqat HTTPS'da ishlaydi.

---

## Productionda hozircha ishlamaydigan narsalar

| Funksiya | Holat | Nima qilish kerak |
|---|---|---|
| **Parolni tiklash** | Xat yuborilmaydi | `server/services/mailer.js` ga SMTP yoki Resend/SendGrid ulash |
| **Email tasdiqlash** | Xat yuborilmaydi | Yuqoridagi bilan bir xil. Ro'yxatdan o'tish va kirish bunga bog'liq emas — ishlaydi |
| **Bir nechta nusxa (scaling)** | Qo'llab-quvvatlanmaydi | Baza Turso'da bo'lsa ham, rate-limiter va login himoyasi server xotirasida ishlaydi. Replikalar sonini **1** da qoldiring |

Lokal ishlab chiqishda (`127.0.0.1`) tiklash havolalari server konsoliga chiqadi.
Server tashqi manzilga ochiq bo'lsa, bu havolalar **hech qachon** API javobida qaytarilmaydi —
aks holda begona odam istalgan hisobni egallab olishi mumkin edi.

---

## Xavfsizlik ro'yxati

- [ ] `.env` GitHub'da yo'q
- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` — 48 baytli tasodifiy qator, lokaldagidan **farqli**
- [ ] `TURSO_AUTH_TOKEN` hostingda qo'shilgan va `/api/health` da `"db":"turso"`
- [ ] Turso tokeni faqat `zehn` bazasi uchun yaratilgan (butun hisob uchun emas)
- [ ] Sayt HTTPS orqali ochiladi
- [ ] Google AI Studio'da API kalitga oylik limit qo'yilgan
