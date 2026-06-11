/**
 * AuthContext — gerencia estado de autenticação.
 *
 * Expõe:
 *   auth     → { userId, barbershopId, role, barberId, customerId } | null
 *   profile  → { id, name, email, phone }
 *   login(email|phone, password, barbershopId?) → Promise
 *   registerCustomer(data) → Promise
 *   logout()
 *   loading  → boolean (aguarda /auth/me inicial)
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { getTokens, saveTokens, clearTokens, decodeJwt } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth]       = useState(null);  // payload do JWT
  const [profile, setProfile] = useState(null);  // dados do /auth/me
  const [loading, setLoading] = useState(true);  // verificando sessão inicial

  // ── Inicialização: tenta restaurar sessão ───────────────────────────────
  useEffect(() => {
    async function restore() {
      const tokens = getTokens();
      if (!tokens?.accessToken) { setLoading(false); return; }

      // Decodifica localmente (sem ir ao servidor) para setAuth imediato
      const payload = decodeJwt(tokens.accessToken);
      if (payload && payload.exp * 1000 > Date.now()) {
        setAuth({
          userId:        payload.sub,
          barbershopId:  payload.bsid,
          role:          payload.role,
          barberId:      payload.barberId || null,
          customerId:    payload.customerId || null,
        });
        // Busca perfil em background
        api.get('/auth/me')
          .then((d) => { setProfile(d.profile); })
          .catch(() => {});
        connectSocket();
      } else {
        // Token expirado — vai tentar refresh via api.js no próximo request
        setAuth(null);
      }
      setLoading(false);
    }
    restore();
  }, []);

  // ── Login ────────────────────────────────────────────────────────────────
  const login = useCallback(async ({ email, phone, password, barbershopId }) => {
    const data = await api.post('/auth/login', {
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      password,
      ...(barbershopId ? { barbershopId } : {}),
    });

    saveTokens(data.tokens);

    const payload = decodeJwt(data.tokens.accessToken);
    const authCtx = {
      userId:       payload.sub,
      barbershopId: payload.bsid,
      role:         payload.role,
      barberId:     payload.barberId || null,
      customerId:   payload.customerId || null,
    };

    setAuth(authCtx);
    setProfile(data.user);
    connectSocket();

    return authCtx;
  }, []);

  // ── Registro de cliente ──────────────────────────────────────────────────
  const registerCustomer = useCallback(async ({ name, phone, email, password }) => {
    const shopSlug = import.meta.env.VITE_SHOP_SLUG;
    if (!shopSlug) throw new Error('VITE_SHOP_SLUG não configurado');

    const data = await api.post('/auth/register-customer', {
      shopSlug,
      name,
      phone,
      ...(email ? { email } : {}),
      password,
    });

    saveTokens(data.tokens);

    const payload = decodeJwt(data.tokens.accessToken);
    const authCtx = {
      userId:       payload.sub,
      barbershopId: payload.bsid,
      role:         'customer',
      barberId:     null,
      customerId:   data.customer.id,
    };

    setAuth(authCtx);
    setProfile({ name: data.customer.name });
    connectSocket();

    return authCtx;
  }, []);

  // ── Logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    clearTokens();
    disconnectSocket();
    setAuth(null);
    setProfile(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ auth, profile, loading, login, logout, registerCustomer }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth fora de AuthProvider');
  return ctx;
}
