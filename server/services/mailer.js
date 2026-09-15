import { config } from '../config.js';
import { log } from '../lib/logger.js';

/**
 * Xat yuborish qatlami.
 * Dev rejimda xat konsolga chiqadi (SMTP sozlamasdan test qilish uchun).
 * Ishlab chiqarishda shu yerga SMTP yoki provayder (Resend/SES) ulanadi.
 */
const TEMPLATES = {
  verify: {
    uz: (link) => ({ subject: 'Zehn AI — email tasdiqlash', body: `Emailingizni tasdiqlash uchun havolani oching:\n${link}\n\nHavola 24 soat amal qiladi.` }),
    ru: (link) => ({ subject: 'Zehn AI — подтверждение email', body: `Откройте ссылку для подтверждения email:\n${link}\n\nСсылка действует 24 часа.` }),
    en: (link) => ({ subject: 'Zehn AI — verify your email', body: `Open this link to verify your email:\n${link}\n\nThe link is valid for 24 hours.` }),
  },
  reset: {
    uz: (link) => ({ subject: 'Zehn AI — parolni tiklash', body: `Parolni tiklash havolasi:\n${link}\n\nAgar siz so‘ramagan bo‘lsangiz, bu xatni e’tiborsiz qoldiring.` }),
    ru: (link) => ({ subject: 'Zehn AI — сброс пароля', body: `Ссылка для сброса пароля:\n${link}\n\nЕсли вы не запрашивали — проигнорируйте письмо.` }),
    en: (link) => ({ subject: 'Zehn AI — password reset', body: `Password reset link:\n${link}\n\nIf you did not request this, ignore this email.` }),
  },
};

export async function sendMail(type, { to, link, language = 'uz' }) {
  const tpl = TEMPLATES[type]?.[language] || TEMPLATES[type]?.uz;
  if (!tpl) throw new Error(`Noma'lum xat turi: ${type}`);
  const { subject, body } = tpl(link);

  if (config.env !== 'production') {
    log.info(`✉️  [${type}] -> ${to}`);
    log.info(`   ${subject}`);
    log.info(`   ${link}`);
    return { delivered: true, transport: 'console' };
  }

  // Ishlab chiqarish uchun: SMTP/provayder integratsiyasi shu yerga qo'yiladi.
  log.warn('Mail transport sozlanmagan — xat yuborilmadi:', to);
  return { delivered: false, transport: 'none', subject, body };
}
