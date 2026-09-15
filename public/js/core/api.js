/* Backend bilan aloqa: token boshqaruvi, avtomatik yangilash, SSE oqimi */

const TOKEN_KEY = 'zehn.token';
let accessToken = null;
let refreshPromise = null;
const authListeners = new Set();

try { accessToken = localStorage.getItem(TOKEN_KEY); } catch { /* private mode */ }

export const onAuthLost = (fn) => { authListeners.add(fn); return () => authListeners.delete(fn); };

export function setToken(token) {
  accessToken = token || null;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode */ }
}
export const getToken = () => accessToken;

export class ApiError extends Error {
  constructor(message, code, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function headers(extra = {}) {
  const h = { ...extra };
  if (accessToken) h.authorization = `Bearer ${accessToken}`;
  return h;
}

/** Access token muddati tugasa — refresh cookie orqali yangilaymiz (bir marta). */
async function refreshToken() {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) {
          let error = {};
          try { error = (await res.json()).error || {}; } catch { /* JSON emas */ }
          const apiError = new ApiError(error.message || 'Session expired', error.code || 'UNAUTHORIZED', res.status, error.details);
          notifyBlocked(apiError);
          throw apiError;
        }
        const data = await res.json();
        setToken(data.accessToken);
        return data;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function request(path, { method = 'GET', body, raw = false, retry = true } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: headers(body && !raw ? { 'content-type': 'application/json' } : {}),
      body: raw ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK', 'NETWORK', 0);
  }

  if (res.status === 401 && retry && accessToken) {
    try {
      await refreshToken();
    } catch (err) {
      setToken(null);
      // Bloklangan hisob uchun alohida xabar allaqachon ko'rsatilgan
      if (err.code === 'ACCOUNT_BLOCKED') throw err;
      for (const fn of authListeners) fn();
      throw new ApiError('SESSION_EXPIRED', 'UNAUTHORIZED', 401);
    }
    return request(path, { method, body, raw, retry: false });
  }

  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    if (!res.ok) throw new ApiError('HTTP ' + res.status, 'HTTP_ERROR', res.status);
    return res;
  }

  const data = await res.json();
  if (!res.ok || data.ok === false) {
    const err = data.error || {};
    const apiError = new ApiError(err.message || 'Xatolik', err.code || 'ERROR', res.status, err.details);
    notifyBlocked(apiError);
    throw apiError;
  }
  return data;
}

/* Hisob bloklansa — ilova qayerda bo'lishidan qat'i nazar foydalanuvchi chiqariladi */
const blockedListeners = new Set();
export const onAccountBlocked = (fn) => { blockedListeners.add(fn); return () => blockedListeners.delete(fn); };

function notifyBlocked(err) {
  if (err.code !== 'ACCOUNT_BLOCKED') return;
  setToken(null);
  for (const fn of blockedListeners) fn(err);
}

export const api = {
  /* ── Auth ── */
  register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  refresh: refreshToken,
  verifyEmail: (token) => request('/api/auth/verify-email', { method: 'POST', body: { token } }),
  resendVerification: () => request('/api/auth/resend-verification', { method: 'POST' }),
  forgotPassword: (email) => request('/api/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token, password) => request('/api/auth/reset-password', { method: 'POST', body: { token, password } }),
  sessions: () => request('/api/auth/sessions'),
  revokeSession: (id) => request(`/api/auth/sessions/${id}`, { method: 'DELETE' }),
  revokeAllSessions: () => request('/api/auth/sessions/revoke-all', { method: 'POST' }),

  /* ── Chat ── */
  listChats: (params = {}) => {
    const q = new URLSearchParams();
    if (params.archived) q.set('archived', '1');
    if (params.search) q.set('q', params.search);
    const qs = q.toString();
    return request(`/api/chat/chats${qs ? '?' + qs : ''}`);
  },
  createChat: (title) => request('/api/chat/chats', { method: 'POST', body: title ? { title } : {} }),
  getChat: (id) => request(`/api/chat/chats/${id}`),
  updateChat: (id, patch) => request(`/api/chat/chats/${id}`, { method: 'PATCH', body: patch }),
  deleteChat: (id) => request(`/api/chat/chats/${id}`, { method: 'DELETE' }),
  deleteMessage: (id) => request(`/api/chat/messages/${id}`, { method: 'DELETE' }),
  stats: () => request('/api/chat/stats'),

  /* ── Fayllar ── */
  uploadFiles: (formData) => request('/api/files/upload', { method: 'POST', body: formData, raw: true }),
  deleteFile: (id) => request(`/api/files/${id}`, { method: 'DELETE' }),
  fileText: (id) => request(`/api/files/${id}/text`),

  /* ── Profil ── */
  updateProfile: (patch) => request('/api/user/profile', { method: 'PATCH', body: patch }),
  changePassword: (currentPassword, newPassword) =>
    request('/api/user/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
  deleteAccount: (password) => request('/api/user/delete-account', { method: 'POST', body: { password } }),

  usage: () => request('/api/user/usage'),

  /* ── Admin ── */
  adminStats: () => request('/api/admin/stats'),
  adminUsers: (params) => request(`/api/admin/users?${params.toString()}`),
  adminUser: (id) => request(`/api/admin/users/${encodeURIComponent(id)}`),
  adminUpdateUser: (id, patch) => request(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  adminRevokeSessions: (id) => request(`/api/admin/users/${encodeURIComponent(id)}/revoke-sessions`, { method: 'POST' }),

  /* ── Konfiguratsiya ── */
  config: () => request('/api/config'),
};

/**
 * SSE oqimi (POST orqali). EventSource faqat GET'ni qo'llaydi,
 * shuning uchun fetch + ReadableStream ishlatamiz.
 *
 * @param {string} path
 * @param {object} body
 * @param {(event:string, data:object)=>void} onEvent
 * @param {AbortSignal} signal
 */
export async function streamRequest(path, body, onEvent, signal) {
  let res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 401 && accessToken) {
    await refreshToken();
    res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
      signal,
    });
  }

  if (!res.ok) {
    let error = {};
    try { error = (await res.json()).error || {}; } catch { /* JSON emas */ }
    const apiError = new ApiError(error.message || 'Xatolik', error.code || 'STREAM_ERROR', res.status, error.details);
    notifyBlocked(apiError);
    throw apiError;
  }
  if (!res.body) throw new ApiError('Oqim qo‘llab-quvvatlanmaydi', 'NO_STREAM', 0);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith(':')) continue;              // keep-alive

      let event = 'message';
      const dataLines = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      try { onEvent(event, JSON.parse(dataLines.join('\n'))); }
      catch { /* buzilgan bo'lak — o'tkazib yuboramiz */ }
    }
  }
}
