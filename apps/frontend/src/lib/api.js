/**
 * api.js — Camada de comunicação com o backend.
 *
 * - Anexa Authorization: Bearer <token> automaticamente
 * - Tenta refresh automático em 401
 * - Devolve dados parseados ou lança { message, code, details }
 */

const BASE = import.meta.env.VITE_API_URL ?? '/api';

// ── Storage ────────────────────────────────────────────────────────────────

export function getTokens() {
  try {
    const raw = localStorage.getItem('barber_tokens');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens) {
  localStorage.setItem('barber_tokens', JSON.stringify(tokens));
}

export function clearTokens() {
  localStorage.removeItem('barber_tokens');
}

// ── JWT decode (sem verificação — só lê payload) ───────────────────────────

export function decodeJwt(token) {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

// ── Refresh ────────────────────────────────────────────────────────────────

let refreshing = null; // evita múltiplas chamadas simultâneas

async function doRefresh() {
  const tokens = getTokens();
  if (!tokens?.refreshToken) throw new Error('no_refresh');

  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });

  if (!res.ok) {
    clearTokens();
    throw new Error('refresh_failed');
  }

  const data = await res.json();
  saveTokens(data.tokens);
  return data.tokens;
}

// ── Fetch base ─────────────────────────────────────────────────────────────

async function request(method, path, body, retry = true) {
  const tokens = getTokens();
  const headers = { 'Content-Type': 'application/json' };
  if (tokens?.accessToken) {
    headers.Authorization = `Bearer ${tokens.accessToken}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 401 → tenta refresh uma vez
  if (res.status === 401 && retry) {
    try {
      if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
      await refreshing;
      return request(method, path, body, false);
    } catch {
      clearTokens();
      window.location.href = '/login';
      throw { message: 'Sessão expirada. Faça login novamente.', code: 'session_expired' };
    }
  }

  // Resposta sem corpo (204)
  if (res.status === 204) return null;

  let data;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) {
    const err = new Error(data.message || 'Erro na requisição');
    err.code = data.error || 'unknown';
    err.details = data.details || null;
    err.status = res.status;
    throw err;
  }

  return data;
}

// ── Métodos exportados ─────────────────────────────────────────────────────

export const api = {
  get:    (path)        => request('GET',    path),
  post:   (path, body)  => request('POST',   path, body),
  patch:  (path, body)  => request('PATCH',  path, body),
  put:    (path, body)  => request('PUT',    path, body),
  delete: (path)        => request('DELETE', path),
};

export default api;
