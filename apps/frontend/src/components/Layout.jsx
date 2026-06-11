/**
 * Layout.jsx — Layouts base por perfil (barbeiro, dono, cliente).
 * Cada layout inclui header + bottom nav + conteúdo.
 */

import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// ── Botão Voltar ──────────────────────────────────────────────────────────
export function BackBtn({ to }) {
  const nav = useNavigate();
  return (
    <button className="btn-back" onClick={() => (to ? nav(to) : nav(-1))}>
      ‹
    </button>
  );
}

// ── Layout do BARBEIRO ────────────────────────────────────────────────────
export function BarberLayout({ children, title, badge, back }) {
  const nav  = useNavigate();
  const loc  = useLocation();
  const { logout, profile } = useAuth();

  const tabs = [
    { path: '/barber',          icon: '⚡', label: 'Atend.' },
    { path: '/barber/agenda',   icon: '📋', label: 'Agenda'  },
    { path: '/barber/comissoes',icon: '💰', label: 'Comissão'},
    { path: '/barber/perfil',   icon: '👤', label: 'Perfil'  },
  ];

  return (
    <div className="page">
      <div className="header">
        {back && <BackBtn />}
        <h1>{title || '✂️ BarberSystem'}</h1>
        {badge && <span className="badge">{badge}</span>}
      </div>

      <div className="content">{children}</div>

      <nav className="bottom-nav">
        {tabs.map((t) => (
          <button
            key={t.path}
            className={`nav-item ${loc.pathname === t.path ? 'active' : ''}`}
            onClick={() => nav(t.path)}
          >
            <span className="nav-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ── Layout do DONO ────────────────────────────────────────────────────────
export function OwnerLayout({ children, title, badge, back }) {
  const nav = useNavigate();
  const loc = useLocation();

  const tabs = [
    { path: '/owner',            icon: '📊', label: 'Dashboard' },
    { path: '/owner/agenda',     icon: '📋', label: 'Agenda'    },
    { path: '/owner/financeiro', icon: '💰', label: 'Financeiro'},
    { path: '/owner/config',     icon: '⚙️', label: 'Config'    },
  ];

  return (
    <div className="page">
      <div className="header">
        {back && <BackBtn />}
        <h1>{title || '📊 Dashboard'}</h1>
        {badge && <span className="badge">{badge}</span>}
      </div>

      <div className="content">{children}</div>

      <nav className="bottom-nav">
        {tabs.map((t) => (
          <button
            key={t.path}
            className={`nav-item ${loc.pathname.startsWith(t.path) && t.path !== '/owner' ? 'active' : loc.pathname === t.path ? 'active' : ''}`}
            onClick={() => nav(t.path)}
          >
            <span className="nav-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ── Layout do CLIENTE ─────────────────────────────────────────────────────
export function CustomerLayout({ children, title, badge, back }) {
  const nav = useNavigate();
  const loc = useLocation();

  const tabs = [
    { path: '/customer',           icon: '🏠', label: 'Início'   },
    { path: '/customer/agendar',   icon: '📅', label: 'Agendar'  },
    { path: '/customer/historico', icon: '🕐', label: 'Histórico'},
    { path: '/customer/perfil',    icon: '👤', label: 'Perfil'   },
  ];

  return (
    <div className="page">
      <div className="header">
        {back && <BackBtn />}
        <h1>{title || '✂️ BarberSystem'}</h1>
        {badge && <span className="badge">{badge}</span>}
      </div>

      <div className="content">{children}</div>

      <nav className="bottom-nav">
        {tabs.map((t) => (
          <button
            key={t.path}
            className={`nav-item ${loc.pathname === t.path ? 'active' : ''}`}
            onClick={() => nav(t.path)}
          >
            <span className="nav-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
