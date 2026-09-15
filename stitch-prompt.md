# Zehn AI — Google Stitch promptlari

> Stitch (stitch.withgoogle.com) ingliz tilida yaxshiroq ishlaydi.
> Har bir ekran uchun alohida prompt bering — bitta uzun prompt o'rniga.
> Avval **1-prompt**ni bering, natija chiqqach **Refine** bo'limida qolganlarini qo'shing.

---

## 1. Asosiy chat ekrani (birinchi bo'lib shuni bering)

```
Design a clean, minimal AI chat web app called "Zehn AI".

Layout: two columns.
Left sidebar (280px, soft off-white / deep charcoal in dark mode):
- Logo "Zehn AI" with a small geometric hexagon mark in indigo
- A "New chat" button with a plus icon, dashed border, full width
- A search input with a magnifier icon
- Chat history grouped under small uppercase labels: "Today", "Yesterday", "Previous 7 days"
- Each chat row: message icon, one line of text, a subtle three-dot menu on hover
- At the bottom: user avatar circle, name, and a settings gear

Main area:
- A slim top bar with the chat title on the left and, on the right, a language pill switch (UZ / RU / EN) and a moon icon for dark mode
- The conversation in a centered 780px column
- User messages: light bordered card, right-aligned avatar with initials
- AI messages: no bubble, plain text on the background, with a small indigo-to-cyan gradient square avatar
- Under each AI message: small ghost buttons "Copy", "Read aloud", "Regenerate"
- A message composer pinned at the bottom: fully rounded pill, soft shadow, with a paperclip icon on the left, a growing text input, a microphone icon and a circular indigo send button on the right
- Small grey disclaimer line under the composer

Style: modern, calm, lots of whitespace, 15px system font, rounded corners (12-22px),
one accent color — indigo #6366F1 with a cyan #22D3EE gradient only on the logo and avatars.
Everything else neutral grey. Subtle borders, no heavy shadows. Simple and beautiful.
```

---

## 2. Bo'sh holat (welcome ekrani)

```
Design the empty state of the Zehn AI chat screen.

Centered in the main area:
- A large outlined hexagon logo mark in indigo
- Headline: "How can I help you today?"
- One grey subtitle line
- Below it, a 2x2 grid of four suggestion cards. Each card: a small indigo icon,
  a bold title and a two-line grey description.
  Cards: "Find a bug in my code", "Evaluate a business idea",
  "Draft a document", "Build a study plan"
- Cards have a thin border, 12px radius and lift slightly on hover

Keep the same sidebar and bottom composer as the main chat screen.
Minimal, airy, generous spacing.
```

---

## 3. Kirish / ro'yxatdan o'tish ekrani

```
Design a split-screen sign-in page for "Zehn AI".

Left half (55%): a dark panel with a deep indigo-to-teal gradient and a faint grid pattern.
On it: the "Zehn AI" logo, a large headline "An AI assistant that understands any problem",
one paragraph of light grey text, and a list of five features, each with a small rounded
icon tile: "Write code and find bugs", "Solve maths problems", "Business ideas and plans",
"Analyse PDF, Word, Excel", "Voice conversation".
At the bottom a small pill badge with a shield icon: "Passwords hashed with scrypt".

Right half (45%): plain background, centered 400px form.
Top-right corner: a UZ / RU / EN pill switch and a dark-mode moon icon.
Form: title "Welcome back", grey subtitle, an Email field, a Password field with an eye
toggle, a "Remember me" checkbox on the left and a "Forgot password?" link on the right,
a full-width indigo primary button "Sign in", and a centered line
"No account yet? Sign up".

Style: clean, minimal, 12px rounded inputs with light borders, indigo #6366F1 accent.
```

---

## 4. Sozlamalar oynasi (modal)

```
Design a settings modal dialog for the Zehn AI app, 560px wide, centered over a dimmed
blurred background, 16px rounded corners.

Header: title "Settings" and a close X button.
Body sections separated by thin dividers:
1. Profile — round avatar with initials, "Upload" and "Remove" small buttons, a full name input
2. Appearance — an interface language row with a UZ / RU / EN pill switch, and a theme row with
   three selectable cards: Light (sun icon), Dark (moon icon), System (monitor icon)
3. Notifications — a label with a small grey hint and an indigo toggle switch on the right
4. Security — "Change password" button and an "Active sessions" list; each session row shows
   a device line like "Chrome · Windows", a grey IP and last-seen line, and a "Sign out" text button
5. Data — "Download my data" button and a red "Delete account" text button

Footer: a grey "Cancel" button and an indigo "Save" button, right aligned.
Simple, calm, clearly grouped.
```

---

## 5. Ovoz yozish holati (mikrofon bosilganda)

```
Design the voice recording state of the Zehn AI composer.

Above the message composer, show a soft red-tinted rounded panel containing:
a pulsing red dot, a monospace timer "00:07", a thin animated waveform of vertical red bars
filling the middle, the grey hint text "Listening — speak now",
and a small red "Stop" button with a square icon on the right.

The microphone button in the composer is highlighted with a light red circular background.
Everything else stays unchanged. Subtle and calm, not alarming.
```

---

## Stitch'da nima yozish kerak emas

- "Make it look like ChatGPT" — Stitch umumiy shablon beradi, o'ziga xoslik yo'qoladi
- Juda ko'p rang — bitta accent (indigo) yetarli, qolgani neytral kulrang
- Bir promptda 5 ta ekran — har bir ekran alohida bo'lsin

## Dizayn tizimi (Stitch natijasini kodga o'tkazishda)

| Element | Qiymat |
|---|---|
| Accent | `#6366F1` (indigo), gradient juftligi `#22D3EE` (cyan) |
| Fon (yorug') | `#F7F8FA`, sirt `#FFFFFF` |
| Fon (qorong'i) | `#0B0D12`, sirt `#141821` |
| Matn (yorug') | `#14161A`, ikkilamchi `#4A5160` |
| Chegara | `#E2E6EE` / qorong'ida `#232833` |
| Radius | tugma 12px, kartochka 12-16px, composer 22px |
| Shrift | system-ui, 15px asos, 1.6 line-height |
| Sidebar eni | 276px, suhbat ustuni 780px |

Bu qiymatlar loyihadagi `public/css/tokens.css` bilan bir xil — Stitch natijasini
shu tokenlarga moslashtirsangiz, dizayn kod bilan mos tushadi.
