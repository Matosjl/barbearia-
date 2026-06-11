/**
 * Login.jsx
 *
 * Tabs: Dono/Barbeiro (email+senha) | Cliente (telefone+senha) | Cadastro cliente
 * Redireciona para a área correta após login, com base no role do JWT.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ErrorBox } from '../components/ui.jsx';

const ROLE_PATH = { barber: '/barber', owner: '/owner', manager: '/owner', customer: '/customer' };

export default function Login() {
  const { login, registerCustomer } = useAuth();
  const nav = useNavigate();

  const [tab, setTab]       = useState('staff');   // 'staff' | 'client' | 'register'
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState('');

  // Staff (dono / barbeiro)
  const [email, setEmail]   = useState('');
  const [pass, setPass]     = useState('');

  // Cliente login
  const [phone, setPhone]   = useState('');
  const [passC, setPassC]   = useState('');

  // Cadastro cliente
  const [name, setName]     = useState('');
  const [phoneR, setPhoneR] = useState('');
  const [passR, setPassR]   = useState('');
  const [emailR, setEmailR] = useState('');

  async function handleStaffLogin(e) {
    e.preventDefault();
    if (!email || !pass) { setError('Preencha e-mail e senha'); return; }
    setLoad(true); setError('');
    try {
      const auth = await login({ email, password: pass });
      nav(ROLE_PATH[auth.role] ?? '/');
    } catch (err) {
      setError(err.message || 'Credenciais inválidas');
    } finally { setLoad(false); }
  }

  async function handleClientLogin(e) {
    e.preventDefault();
    if (!phone || !passC) { setError('Preencha telefone e senha'); return; }
    setLoad(true); setError('');
    try {
      const auth = await login({ phone, password: passC });
      nav(ROLE_PATH[auth.role] ?? '/');
    } catch (err) {
      setError(err.message || 'Credenciais inválidas');
    } finally { setLoad(false); }
  }

  async function handleRegister(e) {
    e.preventDefault();
    if (!name || !phoneR || !passR) { setError('Preencha nome, telefone e senha'); return; }
    if (passR.length < 6) { setError('Senha mínima de 6 caracteres'); return; }
    setLoad(true); setError('');
    try {
      await registerCustomer({ name, phone: phoneR, password: passR, email: emailR || undefined });
      nav('/customer');
    } catch (err) {
      setError(err.message || 'Erro no cadastro');
    } finally { setLoad(false); }
  }

  return (
    <div className="login-page">
      <div className="login-hero">
        <div style={{ fontSize: 48, marginBottom: 8 }}>✂️</div>
        <h1>BarberSystem</h1>
        <p>Sistema de gestão de barbearia</p>
      </div>

      <div className="login-body">
        {/* Tabs */}
        <div className="tab-group">
          <button className={`tab ${tab === 'staff'    ? 'active' : ''}`} onClick={() => { setTab('staff');    setError(''); }}>
            Dono / Barbeiro
          </button>
          <button className={`tab ${tab === 'client'   ? 'active' : ''}`} onClick={() => { setTab('client');   setError(''); }}>
            Sou Cliente
          </button>
          <button className={`tab ${tab === 'register' ? 'active' : ''}`} onClick={() => { setTab('register'); setError(''); }}>
            Cadastrar
          </button>
        </div>

        <ErrorBox message={error} />

        {/* ── Tab: Dono / Barbeiro ── */}
        {tab === 'staff' && (
          <form onSubmit={handleStaffLogin}>
            <span className="label">E-mail</span>
            <input
              className="input"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
            />
            <span className="label" style={{ marginTop: 12 }}>Senha</span>
            <input
              className="input"
              type="password"
              placeholder="••••••"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="current-password"
            />
            <div className="spacer-lg" />
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        )}

        {/* ── Tab: Cliente login ── */}
        {tab === 'client' && (
          <form onSubmit={handleClientLogin}>
            <span className="label">Telefone</span>
            <input
              className="input"
              type="tel"
              placeholder="(11) 99999-9999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              inputMode="tel"
            />
            <span className="label" style={{ marginTop: 12 }}>Senha</span>
            <input
              className="input"
              type="password"
              placeholder="••••••"
              value={passC}
              onChange={(e) => setPassC(e.target.value)}
            />
            <div className="spacer-lg" />
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
            <div className="spacer" />
            <button
              type="button"
              className="btn btn-ghost-muted btn-sm"
              onClick={() => { setTab('register'); setError(''); }}
            >
              Não tem conta? Cadastrar-se
            </button>
          </form>
        )}

        {/* ── Tab: Cadastro cliente ── */}
        {tab === 'register' && (
          <form onSubmit={handleRegister}>
            <span className="label">Nome completo *</span>
            <input
              className="input"
              type="text"
              placeholder="Seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
            <span className="label" style={{ marginTop: 12 }}>Telefone *</span>
            <input
              className="input"
              type="tel"
              placeholder="(11) 99999-9999"
              value={phoneR}
              onChange={(e) => setPhoneR(e.target.value)}
              inputMode="tel"
            />
            <span className="label" style={{ marginTop: 12 }}>E-mail (opcional)</span>
            <input
              className="input"
              type="email"
              placeholder="seu@email.com (opcional)"
              value={emailR}
              onChange={(e) => setEmailR(e.target.value)}
              inputMode="email"
            />
            <span className="label" style={{ marginTop: 12 }}>Senha * (mín. 6 caracteres)</span>
            <input
              className="input"
              type="password"
              placeholder="••••••"
              value={passR}
              onChange={(e) => setPassR(e.target.value)}
            />
            <div className="spacer-lg" />
            <button className="btn btn-success" type="submit" disabled={loading}>
              {loading ? 'Cadastrando...' : 'Criar conta'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
