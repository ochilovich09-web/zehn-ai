/* Kirish / ro'yxatdan o'tish / parolni tiklash ekranlari */
import { $, $$, renderIcons } from '../core/dom.js';
import { api, setToken, ApiError } from '../core/api.js';
import { t, getLanguage } from '../core/i18n.js';
import { toast } from './toast.js';

const FORMS = { login: '#form-login', register: '#form-register', forgot: '#form-forgot', reset: '#form-reset' };
let onAuthenticated = () => {};
let resetToken = null;

export function initAuth(onSuccess) {
  onAuthenticated = onSuccess;

  // Ekranlar orasida o'tish
  document.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) { e.preventDefault(); showForm(goto.dataset.goto); }

    const eye = e.target.closest('[data-toggle-password]');
    if (eye) togglePassword(eye);
  });

  $('#form-login').addEventListener('submit', handleLogin);
  $('#form-register').addEventListener('submit', handleRegister);
  $('#form-forgot').addEventListener('submit', handleForgot);
  $('#form-reset').addEventListener('submit', handleReset);

  // Parol kuchini ko'rsatish
  const pwInput = $('#form-register input[name="password"]');
  pwInput?.addEventListener('input', () => updateStrength(pwInput));

  handleHashRoute();
  window.addEventListener('hashchange', handleHashRoute);
}

export function showAuth() {
  $('#auth-view').hidden = false;
  $('#app-view').hidden = true;
}

function showForm(name) {
  for (const [key, sel] of Object.entries(FORMS)) $(sel).hidden = key !== name;
}

/** #/verify?token=... va #/reset?token=... havolalarini qayta ishlash */
async function handleHashRoute() {
  const hash = location.hash.slice(1);
  if (!hash.startsWith('/')) return;
  const [path, queryString] = hash.slice(1).split('?');
  const token = new URLSearchParams(queryString || '').get('token');
  if (!token) return;

  if (path === 'verify') {
    try {
      await api.verifyEmail(token);
      toast(t('success.verified'), 'success');
    } catch (err) {
      toast(err.message || t('error.generic'), 'error');
    }
    history.replaceState(null, '', location.pathname);
  }

  if (path === 'reset') {
    resetToken = token;
    showAuth();
    showForm('reset');
    history.replaceState(null, '', location.pathname);
  }
}

/* ── Yuborish jarayoni ── */
async function submit(form, action) {
  const button = form.querySelector('button[type="submit"]');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '...';
  try {
    await action();
  } catch (err) {
    // Bloklangan hisob xabarini (sababi bilan) main.js ko'rsatadi
    if (err.code === 'ACCOUNT_BLOCKED') return;
    const message = err instanceof ApiError && err.code === 'NETWORK' ? t('error.network') : err.message || t('error.generic');
    toast(message, 'error');
    if (err.details?.checks) highlightWeak(form);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function values(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function handleLogin(e) {
  e.preventDefault();
  const form = e.target;
  await submit(form, async () => {
    const { email, password } = values(form);
    const res = await api.login({ email, password });
    setToken(res.accessToken);
    toast(t('success.login'), 'success');
    onAuthenticated(res.user);
  });
}

async function handleRegister(e) {
  e.preventDefault();
  const form = e.target;
  const data = values(form);

  if (data.password !== data.confirmPassword) {
    toast(getLanguage() === 'ru' ? 'Пароли не совпадают' : getLanguage() === 'en' ? 'Passwords do not match' : 'Parollar mos kelmadi', 'error');
    return;
  }

  await submit(form, async () => {
    const res = await api.register({
      fullName: data.fullName,
      email: data.email,
      password: data.password,
      confirmPassword: data.confirmPassword,
      language: getLanguage(),
    });
    setToken(res.accessToken);
    toast(t('success.register'), 'success');
    if (res.devVerifyLink) console.info('Dev verify link:', res.devVerifyLink);
    onAuthenticated(res.user);
  });
}

async function handleForgot(e) {
  e.preventDefault();
  const form = e.target;
  await submit(form, async () => {
    const res = await api.forgotPassword(values(form).email);
    toast(t('success.mailSent'), 'success', 6000);
    if (res.devResetLink) {
      console.info('Dev reset link:', res.devResetLink);
      toast('Dev: havola konsolda (F12)', 'info', 7000);
    }
    showForm('login');
  });
}

async function handleReset(e) {
  e.preventDefault();
  const form = e.target;
  await submit(form, async () => {
    if (!resetToken) throw new Error(t('error.generic'));
    await api.resetPassword(resetToken, values(form).password);
    resetToken = null;
    toast(t('success.reset'), 'success');
    showForm('login');
  });
}

/* ── Yordamchilar ── */
function togglePassword(button) {
  const input = button.parentElement.querySelector('input');
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.replaceChildren();
  button.append(Object.assign(document.createElement('i'), { dataset: { icon: show ? 'eye-off' : 'eye' } }));
  renderIcons(button);
}

function updateStrength(input) {
  const value = input.value;
  const bar = input.closest('.field').querySelector('.strength');
  const note = input.closest('.field').querySelector('[data-strength-note]');
  if (!bar) return;

  const checks = [value.length >= 8, /[a-z]/.test(value), /[A-Z]/.test(value), /[0-9]/.test(value), /[^A-Za-z0-9]/.test(value)];
  const score = Math.min(4, checks.filter(Boolean).length - (value.length >= 8 ? 0 : 1));
  bar.dataset.score = value ? Math.max(score, 1) : 0;

  const labels = {
    uz: ['', 'Juda kuchsiz', 'Kuchsiz', 'Yaxshi', 'Kuchli'],
    ru: ['', 'Очень слабый', 'Слабый', 'Хороший', 'Сильный'],
    en: ['', 'Very weak', 'Weak', 'Good', 'Strong'],
  }[getLanguage()] || [];
  if (note) note.textContent = value ? labels[Math.max(score, 1)] || '' : '';
}

function highlightWeak(form) {
  const input = form.querySelector('input[name="password"]');
  if (!input) return;
  input.setAttribute('aria-invalid', 'true');
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'), { once: true });
}

/** Parolni tiklash formasi ochilishini tashqaridan boshqarish uchun */
export const authView = { showForm };
