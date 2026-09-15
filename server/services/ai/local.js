/**
 * LOCAL REASONING ENGINE — API kaliti bo'lmaganda ishlaydigan zaxira dvigatel.
 *
 * Bu "soxta AI" emas: u tahlil natijasiga (analyze()) tayanib, muammoni
 * qismlarga ajratadi, variantlarni taqqoslaydi, amaliy qadamlar beradi,
 * matematik masalani haqiqatan yechadi va biriktirilgan faylni real tahlil qiladi.
 * Bilmagan narsasini bilgandek ko'rsatmaydi — chegaralarini ochiq aytadi.
 */
import { trySolve } from './mathkit.js';

const L = {
  understood: { uz: 'Savolingizni qanday tushundim', ru: 'Как я понял ваш запрос', en: 'How I read your request' },
  breakdown: { uz: 'Masalani qismlarga ajratamiz', ru: 'Разберем задачу на части', en: 'Breaking the problem down' },
  options: { uz: 'Yechim yo‘llari', ru: 'Пути решения', en: 'Solution paths' },
  recommend: { uz: 'Tavsiyam', ru: 'Рекомендация', en: 'Recommendation' },
  steps: { uz: 'Amaliy qadamlar', ru: 'Практические шаги', en: 'Action steps' },
  clarify: { uz: 'Aniqlashtiruvchi savollar', ru: 'Уточняющие вопросы', en: 'Clarifying questions' },
  clarifyIntro: {
    uz: 'Aniq javob berishim uchun quyidagilar kerak:',
    ru: 'Чтобы ответить точно, мне нужно уточнить:',
    en: 'To answer precisely I need to know:',
  },
  meanwhile: {
    uz: 'Shu paytgacha ma’lum bo‘lgan qism bo‘yicha yo‘nalish:',
    ru: 'А пока — направление по тому, что уже известно:',
    en: 'Meanwhile, here is a direction based on what is known:',
  },
  pros: { uz: 'Kuchli tomoni', ru: 'Плюс', en: 'Pro' },
  cons: { uz: 'Cheklovi', ru: 'Минус', en: 'Con' },
  option: { uz: 'Variant', ru: 'Вариант', en: 'Option' },
  mathResult: { uz: 'Hisob-kitob', ru: 'Вычисление', en: 'Calculation' },
  answer: { uz: 'Javob', ru: 'Ответ', en: 'Answer' },
  verified: { uz: 'tekshirildi', ru: 'проверено', en: 'verified' },
  fileAnalysis: { uz: 'Fayl tahlili', ru: 'Анализ файла', en: 'File analysis' },
  nextQuestion: {
    uz: 'Qaysi qadamni batafsil ochib beray?',
    ru: 'Какой шаг разобрать подробнее?',
    en: 'Which step should I expand on?',
  },
  offlineNote: {
    uz: '_Lokal reasoning rejimi: server `ANTHROPIC_API_KEY` siz ishlayapti. Tahlil, tuzilma va hisob-kitob haqiqiy, lekin keng bilim bazasi ulanmagan. To‘liq imkoniyat uchun `.env` faylga API kalitni qo‘shing._',
    ru: '_Локальный режим рассуждений: сервер работает без `ANTHROPIC_API_KEY`. Анализ, структура и вычисления настоящие, но большая база знаний не подключена. Добавьте ключ в `.env` для полного режима._',
    en: '_Local reasoning mode: the server is running without `ANTHROPIC_API_KEY`. The analysis, structure and calculations are real, but no broad knowledge base is connected. Add the key to `.env` for the full mode._',
  },
};

const t = (key, lang) => L[key][lang] || L[key].uz;

/* ── Soha bo'yicha "playbook"lar ────────────────────────────────────── */
const PLAYBOOKS = {
  programming: {
    parts: {
      uz: ['Kutilgan natija nima va hozir nima bo‘lyapti', 'Xato qaysi qatlamda: ma’lumot, mantiq yoki muhit', 'Eng kichik takrorlanuvchi misol (minimal repro)', 'Tekshiruv usuli: log, debugger yoki test'],
      ru: ['Что ожидается и что происходит сейчас', 'На каком слое сбой: данные, логика или окружение', 'Минимальный воспроизводимый пример', 'Способ проверки: логи, отладчик или тест'],
      en: ['Expected result vs actual behaviour', 'Which layer fails: data, logic or environment', 'A minimal reproducible example', 'How to verify: logs, debugger or a test'],
    },
    options: {
      uz: [['Tez tuzatish (patch)', 'Bir necha daqiqada natija', 'Sabab qolib ketadi, qayta chiqishi mumkin'],
        ['Sababni topib tuzatish', 'Muammo butunlay yopiladi', 'Ko‘proq vaqt talab qiladi'],
        ['Qismni qayta yozish', 'Texnik qarz kamayadi', 'Regressiya xavfi, test kerak']],
      ru: [['Быстрый патч', 'Результат за минуты', 'Причина остается, может повториться'],
        ['Найти и устранить причину', 'Проблема закрывается полностью', 'Требует больше времени'],
        ['Переписать участок', 'Меньше техдолга', 'Риск регрессии, нужны тесты']],
      en: [['Quick patch', 'Fixed in minutes', 'Root cause remains, may return'],
        ['Fix the root cause', 'Closes the issue for good', 'Takes more time'],
        ['Rewrite the section', 'Less technical debt', 'Regression risk, needs tests']],
    },
    steps: {
      uz: ['Xatolik matnini to‘liq o‘qing — qaysi fayl va qator ko‘rsatilgan?', 'O‘sha joyga log qo‘ying va kirish qiymatlarini chiqaring', 'Kirish `undefined`/`null` emasligini tekshiring', 'Kodni eng kichik ishlaydigan holatga qisqartiring', 'Tuzatishdan keyin test yozing — xato qaytmasligi uchun'],
      ru: ['Прочитайте текст ошибки полностью — какой файл и строка?', 'Поставьте лог в этом месте и выведите входные значения', 'Проверьте, что вход не `undefined`/`null`', 'Сократите код до минимального рабочего случая', 'После исправления напишите тест, чтобы ошибка не вернулась'],
      en: ['Read the full error — which file and line?', 'Add a log there and print the input values', 'Check the input is not `undefined`/`null`', 'Reduce the code to a minimal working case', 'Add a test after the fix so it cannot come back'],
    },
  },

  math: {
    parts: {
      uz: ['Berilgan va topilishi kerak bo‘lgan kattaliklar', 'Qaysi qoida/formula qo‘llanadi', 'Hisoblash tartibi', 'Javobni tekshirish usuli'],
      ru: ['Что дано и что нужно найти', 'Какое правило или формула применяется', 'Порядок вычислений', 'Как проверить ответ'],
      en: ['What is given and what must be found', 'Which rule or formula applies', 'Order of operations', 'How to check the answer'],
    },
    steps: {
      uz: ['Shartni belgilar bilan yozing', 'Formulani qo‘llang, oraliq natijani yozib boring', 'Javobni asl shartga qo‘yib tekshiring', 'O‘lchov birligini yozishni unutmang'],
      ru: ['Запишите условие в обозначениях', 'Примените формулу, фиксируйте промежуточные результаты', 'Подставьте ответ обратно в условие', 'Не забудьте единицы измерения'],
      en: ['Write the problem in symbols', 'Apply the formula, keep intermediate results', 'Substitute the answer back into the problem', 'Do not forget the units'],
    },
  },

  business: {
    parts: {
      uz: ['Muammo va maqsadli mijoz', 'Taklif (nima sotasiz va nega sizdan olishadi)', 'Birlik iqtisodi: tannarx, narx, marja', 'Birinchi 10 mijozni qayerdan olasiz', 'Asosiy risklar'],
      ru: ['Проблема и целевой клиент', 'Предложение: что продаете и почему купят у вас', 'Юнит-экономика: себестоимость, цена, маржа', 'Где взять первых 10 клиентов', 'Ключевые риски'],
      en: ['The problem and the target customer', 'The offer: what you sell and why they buy from you', 'Unit economics: cost, price, margin', 'Where the first 10 customers come from', 'Key risks'],
    },
    options: {
      uz: [['Kichik test (MVP)', 'Kam pul, tez javob', 'Natija kichik hajmda'],
        ['To‘liq ishga tushirish', 'Katta hajm imkoni', 'Yuqori xarajat va risk'],
        ['Hamkorlik / franshiza', 'Tayyor tizim va brend', 'Erkinlik kam, to‘lovlar bor']],
      ru: [['Небольшой тест (MVP)', 'Мало денег, быстрый ответ', 'Небольшой масштаб'],
        ['Полный запуск', 'Большой объем сразу', 'Высокие затраты и риск'],
        ['Партнерство / франшиза', 'Готовая система и бренд', 'Меньше свободы, есть платежи']],
      en: [['Small test (MVP)', 'Little money, fast feedback', 'Limited scale'],
        ['Full launch', 'Volume from day one', 'High cost and risk'],
        ['Partnership / franchise', 'Ready system and brand', 'Less freedom, ongoing fees']],
    },
    steps: {
      uz: ['5-10 potensial mijoz bilan gaplashing — muammo haqiqatan bormi?', 'Bitta mahsulot uchun tannarx va narxni hisoblang', 'Eng arzon sinov variantini 2 hafta ichida ishga tushiring', 'Birinchi sotuvlardan keyin raqamlarni qayta ko‘ring', 'Faqat shundan keyin katta xarajat qiling'],
      ru: ['Поговорите с 5-10 потенциальными клиентами — проблема реальна?', 'Посчитайте себестоимость и цену одного продукта', 'Запустите самый дешевый тест за 2 недели', 'После первых продаж пересчитайте цифры', 'Только затем идите на крупные расходы'],
      en: ['Talk to 5-10 potential customers — is the problem real?', 'Compute cost and price for a single unit', 'Launch the cheapest possible test within two weeks', 'Recheck the numbers after the first sales', 'Only then commit serious money'],
    },
    caution: {
      uz: 'Moliyaviy raqamlar taxminiy — yakuniy qarordan oldin buxgalter yoki soha mutaxassisi bilan tekshiring.',
      ru: 'Финансовые цифры ориентировочные — перед решением проверьте с бухгалтером или отраслевым экспертом.',
      en: 'Financial figures are estimates — verify with an accountant or industry expert before deciding.',
    },
  },

  planning: {
    parts: {
      uz: ['Yakuniy maqsad va uni o‘lchash mezoni', 'Mavjud vaqt va resurslar', 'Bosqichlarga bo‘lish', 'Nazorat nuqtalari'],
      ru: ['Конечная цель и критерий ее измерения', 'Доступное время и ресурсы', 'Разбивка на этапы', 'Контрольные точки'],
      en: ['The end goal and how you measure it', 'Available time and resources', 'Breaking it into phases', 'Checkpoints'],
    },
    steps: {
      uz: ['Maqsadni o‘lchanadigan shaklda yozing (raqam + muddat)', 'Umumiy vaqtni 3 bosqichga ajrating', 'Har bosqichga bitta asosiy natija belgilang', 'Haftalik 30 daqiqalik tekshiruv qo‘ying', 'Kechikish bo‘lsa rejani emas, hajmni qisqartiring'],
      ru: ['Сформулируйте цель измеримо (число + срок)', 'Разделите общее время на 3 этапа', 'Задайте по одному ключевому результату на этап', 'Поставьте еженедельную 30-минутную проверку', 'При отставании урезайте объем, а не план целиком'],
      en: ['State the goal measurably (number + deadline)', 'Split the total time into three phases', 'Set one key outcome per phase', 'Schedule a 30-minute weekly review', 'If you slip, cut scope rather than the whole plan'],
    },
  },

  education: {
    parts: {
      uz: ['Hozirgi daraja va maqsad daraja', 'Mavzuning asosiy tushunchalari', 'Amaliyot uchun mashqlar', 'Bilimni tekshirish usuli'],
      ru: ['Текущий и целевой уровень', 'Ключевые понятия темы', 'Упражнения для практики', 'Как проверить усвоение'],
      en: ['Current level and target level', 'Core concepts of the topic', 'Practice exercises', 'How to check understanding'],
    },
    steps: {
      uz: ['Mavzuni bitta jumlada tushuntirib ko‘ring — bo‘shliq shu yerda ko‘rinadi', 'Bitta oddiy misolni oxirigacha yeching', 'Keyin murakkabroq misolga o‘ting', 'Bir kundan keyin yozmasdan takrorlang (aktiv eslash)', 'Boshqa birovga tushuntirib bering'],
      ru: ['Объясните тему одним предложением — пробел станет виден', 'Решите один простой пример до конца', 'Перейдите к более сложному примеру', 'Через день повторите по памяти (активное припоминание)', 'Объясните тему другому человеку'],
      en: ['Explain the topic in one sentence — the gap becomes visible', 'Work one simple example all the way through', 'Move to a harder example', 'Recall it from memory a day later (active recall)', 'Teach it to someone else'],
    },
  },

  technical_support: {
    parts: {
      uz: ['Muammo qachon va nimadan keyin boshlandi', 'Nima o‘zgargan: yangilanish, o‘rnatish, quvvat', 'Muammo doimiymi yoki vaqti-vaqti bilanmi', 'Xavfsiz tekshiruvlar ro‘yxati'],
      ru: ['Когда и после чего началась проблема', 'Что изменилось: обновление, установка, питание', 'Постоянная проблема или периодическая', 'Список безопасных проверок'],
      en: ['When it started and what happened right before', 'What changed: an update, an install, power', 'Constant or intermittent', 'A list of safe checks'],
    },
    steps: {
      uz: ['Qurilmani to‘liq o‘chirib, 30 soniyadan keyin yoqing', 'Kabel va quvvat manbaini boshqasiga almashtirib ko‘ring', 'Oxirgi o‘rnatilgan dastur/yangilanishni olib tashlang', 'Xavfsiz rejimda (safe mode) ishga tushiring', 'Muhim ma’lumotni nusxalang — keyingi qadamlar xavfliroq'],
      ru: ['Полностью выключите устройство и включите через 30 секунд', 'Попробуйте другой кабель и другой источник питания', 'Удалите последнюю установленную программу/обновление', 'Запустите в безопасном режиме', 'Сделайте копию важных данных — дальше шаги рискованнее'],
      en: ['Power the device off fully, wait 30 seconds, power on', 'Try a different cable and a different power source', 'Remove the most recent install or update', 'Boot into safe mode', 'Back up important data — the next steps are riskier'],
    },
    caution: {
      uz: 'Qurilmani ochish yoki tizim fayllarini o‘chirish kafolatni bekor qilishi va ma’lumot yo‘qotishga olib kelishi mumkin.',
      ru: 'Вскрытие устройства или удаление системных файлов может аннулировать гарантию и привести к потере данных.',
      en: 'Opening the device or deleting system files can void the warranty and cause data loss.',
    },
  },

  documents: {
    parts: {
      uz: ['Hujjat turi va kimga mo‘ljallangani', 'Majburiy bo‘limlar', 'Uslub: rasmiy yoki erkin', 'Yakuniy tekshiruv ro‘yxati'],
      ru: ['Тип документа и адресат', 'Обязательные разделы', 'Стиль: официальный или свободный', 'Финальный чек-лист'],
      en: ['Document type and its recipient', 'Required sections', 'Tone: formal or informal', 'Final checklist'],
    },
    steps: {
      uz: ['Hujjat maqsadini bitta jumlada yozing', 'Bo‘limlar tuzilmasini tuzing (sarlavhalar)', 'Har bo‘limni 2-4 jumla bilan to‘ldiring', 'Ismlar, sanalar va raqamlarni tekshiring', 'Ovoz chiqarib o‘qing — noqulay jumlalar shunda bilinadi'],
      ru: ['Сформулируйте цель документа одним предложением', 'Составьте структуру разделов (заголовки)', 'Заполните каждый раздел 2-4 предложениями', 'Проверьте имена, даты и цифры', 'Прочитайте вслух — так слышны неудачные фразы'],
      en: ['State the document goal in one sentence', 'Draft the section structure (headings)', 'Fill each section with 2-4 sentences', 'Verify names, dates and numbers', 'Read it aloud — awkward sentences surface that way'],
    },
  },

  creative: {
    parts: {
      uz: ['Kimga mo‘ljallangan (auditoriya)', 'Qanday ohang kerak', 'Cheklovlar: uzunlik, uslub, kanal', 'Muvaffaqiyat mezoni'],
      ru: ['Для кого (аудитория)', 'Какая нужна тональность', 'Ограничения: длина, стиль, канал', 'Критерий успеха'],
      en: ['Who it is for (audience)', 'What tone is needed', 'Constraints: length, style, channel', 'What success looks like'],
    },
    steps: {
      uz: ['10 ta xom g‘oyani filtrsiz yozing', 'Eng yaxshi 3 tasini tanlang', 'Har birini bitta jumlada aniqlashtiring', 'Kimgadir ko‘rsatib, birinchi reaksiyani kuzating', 'Faqat g‘olib variantni sayqallang'],
      ru: ['Напишите 10 сырых идей без фильтра', 'Выберите 3 лучшие', 'Уточните каждую одним предложением', 'Покажите кому-нибудь и заметьте первую реакцию', 'Дорабатывайте только победивший вариант'],
      en: ['Write 10 raw ideas without filtering', 'Pick the best three', 'Sharpen each into one sentence', 'Show them to someone and watch the first reaction', 'Polish only the winner'],
    },
  },

  work_project: {
    parts: {
      uz: ['Loyihaning aniq natijasi', 'Ishtirokchilar va javobgarlik', 'Muddat va bog‘liqliklar', 'Xavflar va zaxira reja'],
      ru: ['Конкретный результат проекта', 'Участники и зоны ответственности', 'Сроки и зависимости', 'Риски и запасной план'],
      en: ['The concrete project outcome', 'People and ownership', 'Deadlines and dependencies', 'Risks and a fallback'],
    },
    steps: {
      uz: ['Natijani "tayyor" deb hisoblash mezonini yozing', 'Ishni 1-3 kunlik bo‘laklarga bo‘ling', 'Har bo‘lakka bitta mas’ul belgilang', 'Bog‘liq vazifalarni birinchi qo‘ying', 'Haftalik qisqa status uchrashuvi o‘tkazing'],
      ru: ['Опишите критерий готовности результата', 'Разбейте работу на куски по 1-3 дня', 'Назначьте одного ответственного на кусок', 'Поставьте зависимые задачи первыми', 'Проводите короткий еженедельный статус'],
      en: ['Write the definition of done', 'Split the work into 1-3 day chunks', 'Give each chunk a single owner', 'Front-load the dependent tasks', 'Hold a short weekly status check'],
    },
  },

  personal: {
    parts: {
      uz: ['Hozirgi holat va nimani o‘zgartirmoqchisiz', 'Cheklovlar: vaqt, energiya, muhit', 'Eng kichik boshlash qadami', 'Barqarorlik: qanday kuzatasiz'],
      ru: ['Текущее состояние и что хотите изменить', 'Ограничения: время, энергия, окружение', 'Минимальный первый шаг', 'Устойчивость: как отслеживать'],
      en: ['Where you are now and what you want to change', 'Constraints: time, energy, environment', 'The smallest possible first step', 'Consistency: how you will track it'],
    },
    steps: {
      uz: ['Maqsadni kunlik 10 daqiqalik amalga aylantiring', 'Uni allaqachon bor odatga bog‘lang', 'Bajarganingizni belgilab boring', 'Haftada bir marta natijani ko‘rib chiqing', 'Uzilish bo‘lsa, keyingi kuni qaytadan boshlang'],
      ru: ['Превратите цель в ежедневное действие на 10 минут', 'Привяжите его к уже существующей привычке', 'Отмечайте выполнение', 'Раз в неделю смотрите на результат', 'После срыва возвращайтесь на следующий же день'],
      en: ['Turn the goal into a daily 10-minute action', 'Anchor it to a habit you already have', 'Mark each day you do it', 'Review the result once a week', 'After a miss, restart the very next day'],
    },
  },

  technology: {
    parts: {
      uz: ['Qanday vazifani hal qilmoqchisiz', 'Mavjud imkoniyatlar va cheklovlar', 'Variantlar orasidagi asosiy farq', 'Xarajat va murakkablik'],
      ru: ['Какую задачу нужно решить', 'Доступные возможности и ограничения', 'Ключевая разница между вариантами', 'Стоимость и сложность'],
      en: ['What task you need to solve', 'Available options and constraints', 'The key difference between options', 'Cost and complexity'],
    },
    steps: {
      uz: ['Talablarni ro‘yxat qilib yozing (majburiy / ixtiyoriy)', 'Har variantni shu ro‘yxat bo‘yicha baholang', 'Kichik sinov o‘tkazing', 'Qaror sababini yozib qo‘ying — keyin kerak bo‘ladi'],
      ru: ['Выпишите требования (обязательные / желательные)', 'Оцените каждый вариант по этому списку', 'Проведите небольшой тест', 'Запишите причину решения — пригодится позже'],
      en: ['List your requirements (must-have / nice-to-have)', 'Score each option against that list', 'Run a small trial', 'Write down why you decided — you will need it later'],
    },
  },

  daily: {
    parts: {
      uz: ['Aniq nima kerak', 'Qancha vaqt va mablag‘ bor', 'Mavjud variantlar', 'Eng qulay tanlov'],
      ru: ['Что именно нужно', 'Сколько есть времени и средств', 'Доступные варианты', 'Самый удобный выбор'],
      en: ['What exactly you need', 'Time and money available', 'The available options', 'The most convenient choice'],
    },
    steps: {
      uz: ['Talabni bitta jumlada aniqlang', '2-3 variantni yonma-yon qo‘ying', 'Narx va vaqt bo‘yicha solishtiring', 'Bugun bajariladigan bitta qadamni tanlang'],
      ru: ['Сформулируйте запрос одним предложением', 'Положите рядом 2-3 варианта', 'Сравните по цене и времени', 'Выберите один шаг на сегодня'],
      en: ['State the need in one sentence', 'Put 2-3 options side by side', 'Compare on price and time', 'Pick one step to do today'],
    },
  },

  general: {
    parts: {
      uz: ['So‘rovning asosiy maqsadi', 'Ma’lum bo‘lgan ma’lumot', 'Yetishmayotgan ma’lumot', 'Keyingi mantiqiy qadam'],
      ru: ['Основная цель запроса', 'Что уже известно', 'Чего не хватает', 'Следующий логичный шаг'],
      en: ['The main goal of the request', 'What is already known', 'What is missing', 'The next logical step'],
    },
    steps: {
      uz: ['Savolni aniqroq shaklda qayta yozing', 'Kerakli ma’lumotni to‘plang', 'Bitta variantni tanlab sinab ko‘ring', 'Natijaga qarab yo‘nalishni tuzating'],
      ru: ['Переформулируйте вопрос точнее', 'Соберите нужные данные', 'Выберите один вариант и попробуйте', 'Скорректируйте направление по результату'],
      en: ['Restate the question more precisely', 'Gather the missing information', 'Pick one option and try it', 'Adjust direction based on the result'],
    },
  },
};

const INTENT_LEAD = {
  debug: { uz: 'texnik nosozlikni topish', ru: 'найти техническую неисправность', en: 'find a technical fault' },
  explain: { uz: 'tushuncha izohini olish', ru: 'получить объяснение', en: 'get an explanation' },
  howto: { uz: 'bosqichma-bosqich yo‘riqnoma olish', ru: 'получить пошаговую инструкцию', en: 'get a step-by-step guide' },
  create: { uz: 'yangi narsa yaratish', ru: 'создать что-то новое', en: 'create something new' },
  compare: { uz: 'variantlarni taqqoslash', ru: 'сравнить варианты', en: 'compare options' },
  summarize: { uz: 'qisqacha xulosa olish', ru: 'получить краткое резюме', en: 'get a summary' },
  analyze: { uz: 'tahlil qilish', ru: 'провести анализ', en: 'run an analysis' },
  plan: { uz: 'reja tuzish', ru: 'составить план', en: 'build a plan' },
  translate: { uz: 'tarjima qilish', ru: 'перевести', en: 'translate' },
  decide: { uz: 'qaror qabul qilish', ru: 'принять решение', en: 'make a decision' },
  question: { uz: 'savolga javob olish', ru: 'получить ответ на вопрос', en: 'get an answer' },
};

const DOMAIN_NAME = {
  programming: { uz: 'dasturlash', ru: 'программирование', en: 'programming' },
  math: { uz: 'matematika', ru: 'математика', en: 'mathematics' },
  business: { uz: 'biznes', ru: 'бизнес', en: 'business' },
  planning: { uz: 'rejalashtirish', ru: 'планирование', en: 'planning' },
  education: { uz: 'ta’lim', ru: 'образование', en: 'education' },
  documents: { uz: 'hujjatlar', ru: 'документы', en: 'documents' },
  technical_support: { uz: 'texnik yordam', ru: 'техподдержка', en: 'technical support' },
  creative: { uz: 'ijodiy ish', ru: 'творчество', en: 'creative work' },
  work_project: { uz: 'ish va loyiha', ru: 'работа и проекты', en: 'work and projects' },
  personal: { uz: 'shaxsiy rivojlanish', ru: 'личное развитие', en: 'personal development' },
  technology: { uz: 'texnologiya', ru: 'технологии', en: 'technology' },
  daily: { uz: 'kundalik masala', ru: 'бытовой вопрос', en: 'everyday matter' },
  general: { uz: 'umumiy mavzu', ru: 'общая тема', en: 'general topic' },
};

const GREETING_RX = /^(salom|assalom|hayrli|qalaysan|привет|здравств|добрый|hi|hello|hey|hola)\b/i;

const GREETING_REPLY = {
  uz: `Salom! Men Zehn AI — universal yordamchiman.

Quyidagilarda yordam bera olaman:
- **Dasturlash** — kod yozish, xatolikni topish, tushuntirish
- **Matematika** — tenglama yechish, hisob-kitob
- **Biznes va rejalashtirish** — g‘oyani tekshirish, reja tuzish
- **Hujjatlar** — ariza, rezyume, xat yozish
- **Ta’lim** — mavzuni bosqichma-bosqich tushuntirish
- **Texnik nosozliklar** — qurilma va dastur muammolari
- **Fayl tahlili** — PDF, Word, Excel, CSV yuklab tahlil qildirish

Muammoingizni yozing — men uni qismlarga ajratib, yechim yo‘llarini taqqoslab beraman.`,
  ru: `Здравствуйте! Я Zehn AI — универсальный ассистент.

Могу помочь с:
- **Программированием** — писать код, находить ошибки, объяснять
- **Математикой** — решать уравнения, считать
- **Бизнесом и планированием** — проверить идею, составить план
- **Документами** — заявления, резюме, письма
- **Обучением** — объяснить тему пошагово
- **Техническими неполадками** — проблемы устройств и программ
- **Анализом файлов** — PDF, Word, Excel, CSV

Опишите задачу — я разберу ее на части и сравню пути решения.`,
  en: `Hello! I am Zehn AI, a universal assistant.

I can help with:
- **Programming** — writing code, finding bugs, explaining
- **Mathematics** — solving equations, calculations
- **Business and planning** — testing an idea, building a plan
- **Documents** — applications, resumes, letters
- **Learning** — explaining a topic step by step
- **Technical faults** — device and software problems
- **File analysis** — PDF, Word, Excel, CSV

Describe your problem and I will break it down and compare the solution paths.`,
};

/* ── Fayl tahlili (haqiqiy statistika) ──────────────────────────────── */
const STOP = new Set(['va', 'bilan', 'uchun', 'bu', 'shu', 'ham', 'the', 'and', 'for', 'that', 'with', 'this',
  'из', 'для', 'что', 'как', 'это', 'the', 'a', 'to', 'of', 'in', 'on', 'is', 'are', 'not', 'не', 'на', 'по']);

export function analyzeAttachment(att, lang) {
  const text = att.text || '';
  const lines = text.split(/\r?\n/);
  const words = text.split(/\s+/).filter(Boolean);
  const rows = [];

  const label = {
    uz: { size: 'Hajm', words: 'So‘zlar', lines: 'Qatorlar', chars: 'Belgilar', cols: 'Ustunlar', records: 'Yozuvlar', topics: 'Tez-tez uchraydigan so‘zlar', headings: 'Sarlavhalar', noText: 'Bu fayldan matn ajratib olinmadi (skanerlangan rasm bo‘lishi mumkin).' },
    ru: { size: 'Размер', words: 'Слов', lines: 'Строк', chars: 'Символов', cols: 'Колонок', records: 'Записей', topics: 'Частые слова', headings: 'Заголовки', noText: 'Из этого файла не удалось извлечь текст (возможно, это скан).' },
    en: { size: 'Size', words: 'Words', lines: 'Lines', chars: 'Characters', cols: 'Columns', records: 'Records', topics: 'Frequent words', headings: 'Headings', noText: 'No text could be extracted from this file (it may be a scan).' },
  }[lang] || {};

  if (!text.trim()) return `**${att.name}** — ${label.noText}`;

  rows.push(`${label.size}: ${formatBytes(att.size)}`);
  rows.push(`${label.words}: ${words.length}`);
  rows.push(`${label.lines}: ${lines.length}`);
  rows.push(`${label.chars}: ${text.length}`);

  // CSV / jadval strukturasi
  if (att.kind === 'data' || att.kind === 'spreadsheet' || /,|;|\t/.test(lines[0] || '')) {
    const delim = [',', ';', '\t', '|'].map((d) => ({ d, n: (lines[0] || '').split(d).length }))
      .sort((a, b) => b.n - a.n)[0];
    if (delim && delim.n > 1) {
      const header = (lines[0] || '').split(delim.d).map((s) => s.trim()).filter(Boolean);
      rows.push(`${label.cols}: ${header.length} (${header.slice(0, 8).join(', ')}${header.length > 8 ? ', ...' : ''})`);
      rows.push(`${label.records}: ${Math.max(lines.filter((l) => l.trim()).length - 1, 0)}`);
    }
  }

  // Sarlavhalar
  const headings = lines.filter((l) => /^#{1,3}\s|^[A-ZА-ЯЀ-ӿ][^.!?]{6,60}:$/.test(l.trim())).slice(0, 5);
  if (headings.length) rows.push(`${label.headings}: ${headings.map((h) => h.replace(/^#+\s*/, '').trim()).join(' • ')}`);

  // Tez-tez uchraydigan so'zlar
  const freq = new Map();
  for (const w of words) {
    const k = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (k.length < 4 || STOP.has(k)) continue;
    freq.set(k, (freq.get(k) || 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) rows.push(`${label.topics}: ${top.map(([w, n]) => `${w} (${n})`).join(', ')}`);

  const preview = text.trim().split(/\r?\n/).slice(0, 6).join('\n').slice(0, 500);
  return `**${att.name}**\n\n${rows.map((r) => `- ${r}`).join('\n')}\n\n\`\`\`\n${preview}${text.length > 500 ? '\n...' : ''}\n\`\`\``;
}

const formatBytes = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/* ── Asosiy generator ───────────────────────────────────────────────── */
export function generateLocalAnswer({ question, analysis, attachments = [] }) {
  const lang = ['uz', 'ru', 'en'].includes(analysis.language) ? analysis.language : 'uz';
  const out = [];

  // 1) Oddiy salomlashish
  if (GREETING_RX.test(question.trim()) && question.trim().split(/\s+/).length <= 4 && !attachments.length) {
    return GREETING_REPLY[lang];
  }

  const pb = PLAYBOOKS[analysis.domain] || PLAYBOOKS.general;
  const pick = (obj) => (obj ? obj[lang] || obj.uz : null);

  // 2) Aniqlashtiruvchi savollar (kerak bo'lsa — birinchi o'ringa)
  if (analysis.ambiguity.shouldAsk && analysis.ambiguity.missing.length) {
    out.push(`### ${t('clarify', lang)}\n\n${t('clarifyIntro', lang)}\n`);
    out.push(analysis.ambiguity.missing.map((m, i) => `${i + 1}. ${m.question}`).join('\n'));
    out.push(`\n${t('meanwhile', lang)}\n`);
  }

  // 3) Savolni qanday tushunganim
  const lead = pick(INTENT_LEAD[analysis.intent]) || pick(INTENT_LEAD.question);
  const dname = pick(DOMAIN_NAME[analysis.domain]) || pick(DOMAIN_NAME.general);
  const summary = {
    uz: `Sizning so‘rovingiz **${dname}** sohasiga tegishli va maqsad — ${lead}. Murakkablik darajasi: ${analysis.complexity}.`,
    ru: `Ваш запрос относится к области **${dname}**, цель — ${lead}. Уровень сложности: ${analysis.complexity}.`,
    en: `Your request falls under **${dname}** and the goal is to ${lead}. Complexity: ${analysis.complexity}.`,
  }[lang];
  out.push(`### ${t('understood', lang)}\n\n${summary}`);

  // 4) Matematik yechim (agar aniqlansa) — bu haqiqiy hisob
  const math = trySolve(question);
  if (math) {
    const block = [`### ${t('mathResult', lang)}\n`];
    if (math.type === 'equation') {
      block.push('```');
      block.push(math.steps.join('\n'));
      block.push('```');
      block.push(`**${t('answer', lang)}: ${math.variable} = ${math.value}**${math.verified ? ` _(${t('verified', lang)})_` : ''}`);
    } else if (math.type === 'equation_nonlinear') {
      block.push({
        uz: `\`${math.expression}\` — bu chiziqli tenglama emas, shuning uchun uni bosqichma-bosqich qo‘lda yechish kerak (ildizlar bir nechta bo‘lishi mumkin).`,
        ru: `\`${math.expression}\` — уравнение нелинейное, его нужно решать отдельно (корней может быть несколько).`,
        en: `\`${math.expression}\` is not linear, so it needs a separate method (there may be several roots).`,
      }[lang]);
    } else {
      block.push(`\`${math.expression} = \`**${math.value}**`);
      if (math.steps) block.push(`\n${math.steps.join('\n')}`);
    }
    out.push(block.join('\n'));
  }

  // 5) Fayl tahlili
  if (attachments.length) {
    out.push(`### ${t('fileAnalysis', lang)}\n\n${attachments.map((a) => analyzeAttachment(a, lang)).join('\n\n')}`);
  }

  // 6) Muammoni qismlarga ajratish
  const parts = pick(pb.parts);
  if (parts) out.push(`### ${t('breakdown', lang)}\n\n${parts.map((p) => `- ${p}`).join('\n')}`);

  // 7) Variantlar taqqoslash
  const options = pick(pb.options);
  if (options) {
    const head = `| ${t('option', lang)} | ${t('pros', lang)} | ${t('cons', lang)} |\n| --- | --- | --- |`;
    const body = options.map(([name, pro, con]) => `| **${name}** | ${pro} | ${con} |`).join('\n');
    out.push(`### ${t('options', lang)}\n\n${head}\n${body}`);

    const rec = {
      uz: `Sizning holatingizda **${options[0][0]}** dan boshlash mantiqiy: eng kam xarajat bilan haqiqiy natijani tez ko‘rasiz. Agar natija ijobiy bo‘lsa, keyingi variantga o‘ting.`,
      ru: `В вашем случае логично начать с варианта **${options[0][0]}**: минимальные затраты и быстрый реальный результат. Если результат положительный — переходите к следующему.`,
      en: `In your case starting with **${options[0][0]}** makes sense: least cost, fastest real signal. If it works out, move to the next option.`,
    }[lang];
    out.push(`### ${t('recommend', lang)}\n\n${rec}`);
  }

  // 8) Amaliy qadamlar
  const steps = pick(pb.steps);
  if (steps) out.push(`### ${t('steps', lang)}\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);

  // 9) Ogohlantirish (agar sohaga tegishli bo'lsa)
  const caution = pick(pb.caution);
  if (caution) out.push(`> ⚠️ ${caution}`);

  // 10) Yakuniy savol + rejim haqida ochiq izoh
  out.push(t('nextQuestion', lang));
  out.push(`\n---\n${t('offlineNote', lang)}`);

  return out.join('\n\n');
}
