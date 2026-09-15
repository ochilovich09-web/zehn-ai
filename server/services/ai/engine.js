/**
 * AI RESPONSE ENGINE — quvur (pipeline):
 *
 *   USER QUESTION -> CONTEXT ANALYSIS -> PROBLEM DETECTION -> REASONING
 *                 -> SOLUTION -> ACTION STEPS
 *
 * Har bosqich klientga SSE orqali xabar qilinadi, shuning uchun interfeysda
 * AI "nima qilayotgani" ko'rinib turadi.
 */
import { config } from '../../config.js';
import { log } from '../../lib/logger.js';
import { analyze } from './classify.js';
import { buildSystemPrompt, buildAttachmentContext, TITLE_PROMPT } from './prompts.js';
import * as anthropic from './anthropic.js';
import * as gemini from './gemini.js';
import { generateLocalAnswer } from './local.js';

/** Sozlamaga qarab provayderni tanlaydi. */
const provider = () => (config.ai.provider === 'gemini' ? gemini : anthropic);
const streamCompletion = (opts) => provider().streamCompletion(opts);
const complete = (opts) => provider().complete(opts);

export const STAGES = ['context_analysis', 'problem_detection', 'reasoning', 'solution'];

const STAGE_LABEL = {
  context_analysis: { uz: 'Kontekst tahlil qilinmoqda', ru: 'Анализирую контекст', en: 'Analyzing context' },
  problem_detection: { uz: 'Muammo aniqlanmoqda', ru: 'Определяю проблему', en: 'Detecting the problem' },
  reasoning: { uz: 'Yechim yo‘llari ko‘rib chiqilmoqda', ru: 'Рассматриваю пути решения', en: 'Weighing solution paths' },
  solution: { uz: 'Javob tayyorlanmoqda', ru: 'Готовлю ответ', en: 'Composing the answer' },
};

const ERROR_TEXT = {
  uz: 'Kechirasiz, javob tayyorlashda texnik xatolik yuz berdi. Savolni qayta yuboring yoki biroz kutib turing.',
  ru: 'Извините, при подготовке ответа произошла техническая ошибка. Повторите запрос или подождите немного.',
  en: 'Sorry, a technical error occurred while preparing the answer. Please resend the question or try again shortly.',
};

/** Suhbat tarixini provider formatiga o'giradi (ketma-ket rollar birlashtiriladi). */
function toProviderMessages(history, currentUserText) {
  const msgs = [];
  for (const h of history) {
    const role = h.role === 'assistant' ? 'assistant' : 'user';
    const content = String(h.content || '').trim();
    if (!content) continue;
    if (msgs.length && msgs.at(-1).role === role) msgs.at(-1).content += `\n\n${content}`;
    else msgs.push({ role, content });
  }
  if (msgs.length && msgs.at(-1).role === 'user') msgs.at(-1).content += `\n\n${currentUserText}`;
  else msgs.push({ role: 'user', content: currentUserText });
  if (msgs[0]?.role !== 'user') msgs.shift();
  return msgs;
}

/** Lokal javobni "yozilayotgandek" bo'laklab uzatadi. */
async function streamLocalText(text, emit, signal) {
  const tokens = text.match(/\S+\s*|\s+/g) || [text];
  let buf = '';
  for (const tok of tokens) {
    if (signal?.aborted) break;
    buf += tok;
    if (buf.length >= 12) { emit(buf); buf = ''; await sleep(14); }
  }
  if (buf) emit(buf);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * To'liq quvurni ishga tushiradi.
 * @param {(event:string, data:object)=>void} send  SSE yuboruvchi
 */
export async function runPipeline({ question, history = [], attachments = [], user, send, signal }) {
  const started = Date.now();
  const userLanguage = user?.language || config.defaultLanguage;

  /* 1-bosqich: CONTEXT ANALYSIS */
  send('stage', { stage: 'context_analysis', label: STAGE_LABEL.context_analysis });
  const analysis = analyze(question, { attachments, history, userLanguage });

  /* 2-bosqich: PROBLEM DETECTION */
  send('stage', { stage: 'problem_detection', label: STAGE_LABEL.problem_detection });
  send('analysis', {
    language: analysis.language,
    domain: analysis.domain,
    domainConfidence: analysis.domainConfidence,
    intent: analysis.intent,
    complexity: analysis.complexity,
    ambiguity: analysis.ambiguity,
    signals: analysis.signals,
    attachments: analysis.attachments,
  });

  /* 3-bosqich: REASONING */
  send('stage', { stage: 'reasoning', label: STAGE_LABEL.reasoning });

  const system = buildSystemPrompt(analysis, { user, attachments });
  const attachmentContext = buildAttachmentContext(attachments);
  const userContent = question + attachmentContext;

  /* 4-bosqich: SOLUTION (oqim) */
  send('stage', { stage: 'solution', label: STAGE_LABEL.solution });

  let text = '';
  let mode = config.ai.enabled ? config.ai.provider : 'local';
  let usage = null;

  try {
    if (config.ai.enabled) {
      const res = await streamCompletion({
        system,
        messages: toProviderMessages(history, userContent),
        maxTokens: analysis.complexity === 'complex' ? config.ai.maxTokens : Math.min(config.ai.maxTokens, 1200),
        signal,
        onDelta: (chunk) => { text += chunk; send('delta', { text: chunk }); },
      });
      usage = res.usage;
      text = res.text || text;
    } else {
      const local = generateLocalAnswer({ question, analysis, attachments });
      await streamLocalText(local, (chunk) => { text += chunk; send('delta', { text: chunk }); }, signal);
    }
  } catch (err) {
    log.error('AI pipeline xatosi:', err.message);
    // Provider ishlamasa — lokal dvigatelga o'tamiz (foydalanuvchi javobsiz qolmaydi)
    if (mode !== 'local' && !signal?.aborted) {
      mode = 'local_fallback';
      const notice = {
        uz: '\n\n> ⚠️ AI provayderi bilan aloqa uzildi, lokal rejimga o‘tildi.\n\n',
        ru: '\n\n> ⚠️ Связь с AI-провайдером прервалась, переключаюсь в локальный режим.\n\n',
        en: '\n\n> ⚠️ Lost connection to the AI provider, switching to local mode.\n\n',
      }[analysis.language] || '';
      if (!text) {
        send('delta', { text: notice });
        text += notice;
        const local = generateLocalAnswer({ question, analysis, attachments });
        await streamLocalText(local, (chunk) => { text += chunk; send('delta', { text: chunk }); }, signal);
      }
    }
    if (!text) {
      text = ERROR_TEXT[analysis.language] || ERROR_TEXT.uz;
      send('delta', { text });
    }
  }

  const meta = {
    mode,
    model: mode !== 'local' && mode !== 'local_fallback' ? config.ai.model : 'zehn-local-reasoner',
    analysis: {
      language: analysis.language, domain: analysis.domain, intent: analysis.intent,
      complexity: analysis.complexity, domainConfidence: analysis.domainConfidence,
      askedClarification: analysis.ambiguity.shouldAsk,
    },
    usage,
    elapsedMs: Date.now() - started,
    attachments: attachments.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
  };

  return { text, analysis, meta };
}

/** Suhbat sarlavhasi: AI bo'lsa — undan, bo'lmasa — matndan aqlli kesish. */
export async function makeTitle(question, language = 'uz') {
  const fallback = () => {
    const clean = question.replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}]+/u, '').trim();
    const words = clean.split(' ').slice(0, 6).join(' ');
    return (words.length > 48 ? words.slice(0, 45) + '…' : words) || 'Yangi suhbat';
  };
  if (!config.ai.enabled) return fallback();
  try {
    const title = await complete({
      system: TITLE_PROMPT[language] || TITLE_PROMPT.uz,
      prompt: question.slice(0, 500),
      maxTokens: 32,
    });
    const clean = title.replace(/^["'«»]|["'«»]$/g, '').trim();
    return clean.slice(0, 60) || fallback();
  } catch {
    return fallback();
  }
}
