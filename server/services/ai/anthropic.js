import { config } from '../../config.js';
import { log } from '../../lib/logger.js';

/**
 * Anthropic Messages API bilan streaming aloqa (tashqi SDK'siz, global fetch orqali).
 * onDelta(matnBo'lagi) har bir yangi bo'lakda chaqiriladi.
 */
export async function streamCompletion({ system, messages, onDelta, signal, maxTokens }) {
  if (!config.ai.enabled) throw new Error('AI_PROVIDER_DISABLED');

  const res = await fetch(config.ai.anthropicUrl, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.ai.apiKey,
      'anthropic-version': config.ai.anthropicVersion,
    },
    body: JSON.stringify({
      model: config.ai.model,
      max_tokens: maxTokens || config.ai.maxTokens,
      system,
      messages,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    log.error('Anthropic API xatosi', res.status, detail.slice(0, 300));
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
  let stopReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      let evt;
      try { evt = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }

      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        full += evt.delta.text;
        onDelta?.(evt.delta.text);
      } else if (evt.type === 'message_delta') {
        if (evt.usage) usage = { ...(usage || {}), ...evt.usage };
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
      } else if (evt.type === 'message_start' && evt.message?.usage) {
        usage = { ...(usage || {}), ...evt.message.usage };
      } else if (evt.type === 'error') {
        throw new Error(evt.error?.message || 'AI_STREAM_ERROR');
      }
    }
  }

  return { text: full, usage, stopReason, model: config.ai.model };
}

/** Oqimsiz, qisqa so'rov (masalan suhbat sarlavhasi uchun). */
export async function complete({ system, prompt, maxTokens = 64 }) {
  if (!config.ai.enabled) throw new Error('AI_PROVIDER_DISABLED');
  const res = await fetch(config.ai.anthropicUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.ai.apiKey,
      'anthropic-version': config.ai.anthropicVersion,
    },
    body: JSON.stringify({
      model: config.ai.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`AI_PROVIDER_ERROR_${res.status}`);
  const data = await res.json();
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
}
