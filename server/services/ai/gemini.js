import { config } from '../../config.js';
import { log } from '../../lib/logger.js';

/**
 * Google Gemini (Generative Language API) provayderi — tashqi SDK'siz.
 *
 * Muhim jihat: Gemini 3.x modellari javobdan oldin "o'ylaydi" va o'sha
 * fikrlash tokenlari ham maxOutputTokens ichidan hisoblanadi. Shuning uchun
 * limitga zaxira qo'shamiz va thinkingLevel'ni pasaytiramiz — aks holda
 * javob matni umuman qaytmasligi mumkin.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const THINKING_HEADROOM = 1024;

const headers = () => ({
  'content-type': 'application/json',
  // Kalit URL'da emas, sarlavhada uzatiladi
  'x-goog-api-key': config.ai.apiKey,
});

/** Ichki xabar formatini Gemini formatiga o'giradi. */
function toContents(messages) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content ?? '') }],
  }));
}

function buildBody({ system, messages, maxTokens, thinking = 'low' }) {
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: toContents(messages),
    generationConfig: {
      maxOutputTokens: (maxTokens || config.ai.maxTokens) + THINKING_HEADROOM,
      temperature: 0.7,
      thinkingConfig: { thinkingLevel: thinking },
    },
  };
}

/** Javob bo'lagidan ko'rinadigan matnni ajratadi (fikrlash qismini tashlab). */
function textFromCandidate(evt) {
  const parts = evt?.candidates?.[0]?.content?.parts || [];
  let out = '';
  for (const part of parts) {
    if (part.thought) continue;              // ichki fikrlash — ko'rsatilmaydi
    if (typeof part.text === 'string') out += part.text;
  }
  return out;
}

const mapUsage = (u) => (u ? {
  input_tokens: u.promptTokenCount,
  output_tokens: u.candidatesTokenCount,
  thinking_tokens: u.thoughtsTokenCount,
  total_tokens: u.totalTokenCount,
} : null);

/** Oqim (streaming) rejimida javob olish. */
export async function streamCompletion({ system, messages, onDelta, signal, maxTokens }) {
  if (!config.ai.enabled) throw new Error('AI_PROVIDER_DISABLED');

  const res = await fetch(`${BASE}/${config.ai.model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    signal,
    headers: headers(),
    body: JSON.stringify(buildBody({ system, messages, maxTokens })),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    log.error('Gemini API xatosi', res.status, detail.slice(0, 300));
    const err = new Error(`AI_PROVIDER_ERROR_${res.status}`);
    err.status = res.status;
    err.detail = detail.slice(0, 300);
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let usage = null;
  let finishReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + (buffer[idx] === '\r' ? 4 : 2));

      const line = block.split(/\r?\n/).find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }

      if (evt.error) throw new Error(evt.error.message || 'AI_STREAM_ERROR');

      const chunk = textFromCandidate(evt);
      if (chunk) { full += chunk; onDelta?.(chunk); }
      if (evt.usageMetadata) usage = mapUsage(evt.usageMetadata);
      if (evt.candidates?.[0]?.finishReason) finishReason = evt.candidates[0].finishReason;
    }
  }

  // Model butun limitni fikrlashga sarflagan bo'lsa, matn bo'sh qoladi
  if (!full && finishReason === 'MAX_TOKENS') {
    throw new Error('AI_EMPTY_RESPONSE_TOKEN_LIMIT');
  }

  return { text: full, usage, stopReason: finishReason, model: config.ai.model };
}

/** Oqimsiz qisqa so'rov (masalan suhbat sarlavhasi uchun). */
export async function complete({ system, prompt, maxTokens = 64 }) {
  if (!config.ai.enabled) throw new Error('AI_PROVIDER_DISABLED');

  const res = await fetch(`${BASE}/${config.ai.model}:generateContent`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(buildBody({
      system,
      messages: [{ role: 'user', content: prompt }],
      maxTokens,
      thinking: 'low',
    })),
  });

  if (!res.ok) throw new Error(`AI_PROVIDER_ERROR_${res.status}`);
  const data = await res.json();
  return textFromCandidate(data).trim();
}
