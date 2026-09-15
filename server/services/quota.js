/**
 * Tarif limitlari: so'nggi 24 soatdagi AI so'rovlari soni.
 * Siljuvchi oyna (rolling window) ishlatiladi — vaqt zonasiga bog'liq emas.
 */
import { config } from '../config.js';
import { Usage } from '../lib/db.js';
import { HttpError } from '../lib/http.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const TIER_NAMES = Object.keys(config.tiers);

/** Foydalanuvchining joriy limit holati. */
export async function getQuota(user) {
  const tier = config.tiers[user.tier] ? user.tier : 'free';
  const limit = config.tiers[tier].dailyRequests;
  const unlimited = user.role === 'admin' || limit === 0;
  const { used, oldest } = await Usage.window(user.id);

  return {
    tier,
    limit: unlimited ? null : limit,
    used,
    remaining: unlimited ? null : Math.max(limit - used, 0),
    unlimited,
    // Eng eski so'rov 24 soatlik oynadan chiqqanda bitta joy bo'shaydi
    resetAt: !unlimited && used >= limit && oldest ? oldest + DAY_MS : null,
  };
}

/** Limit tugagan bo'lsa 429 qaytaradi. */
export async function assertQuota(user) {
  const quota = await getQuota(user);
  if (!quota.unlimited && quota.used >= quota.limit) {
    throw new HttpError(
      429,
      'TIER_LIMIT',
      `Kunlik limit tugadi (${quota.limit} ta so‘rov). Tarifni oshirish uchun administratorga murojaat qiling.`,
      quota
    );
  }
  return quota;
}

/** Tugagan AI so'rovini hisobga yozadi (provayder tokenlari bilan). */
export async function recordUsage({ user, chatId, kind, meta }) {
  const usage = meta?.usage || {};
  await Usage.record({
    userId: user.id,
    chatId,
    kind,
    provider: meta?.mode ?? null,
    model: meta?.model ?? null,
    tokensIn: usage.input_tokens ?? 0,
    // Gemini fikrlash tokenlari ham chiqish sifatida hisoblanadi
    tokensOut: (usage.output_tokens ?? 0) + (usage.thinking_tokens ?? 0),
  });
}
