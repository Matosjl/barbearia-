/**
 * CustomerHome.jsx — Home do cliente.
 * Mostra próximos agendamentos e acesso rápido a agendar / histórico.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CustomerLayout } from '../../components/Layout.jsx';
import { LoadingInline, ErrorBox, StatusTag, EmptyState, fmt, fmtDateTime } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../lib/api';

export default function CustomerHome() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const [appts, setAppts]   = useState([]);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState('');

  useEffect(() => {
    api.get('/appointments/mine')
      .then((d) => {
        const upcoming = (d.data || []).filter((a) =>
          ['pending_hold', 'scheduled', 'confirmed', 'in_progress'].includes(a.status)
        );
        setAppts(upcoming.slice(0, 5));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoad(false));
  }, []);

  return (
    <CustomerLayout title="✂️ BarberSystem">
      {/* Saudação */}
      <div className="card" style={{ marginBottom: 16, background: 'var(--fg)', color: 'white', border: 'none' }}>
        <div style={{ fontSize: 15, opacity: 0.7 }}>Olá,</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{profile?.name?.split(' ')[0] ?? 'Cliente'} 👋</div>
      </div>

      {/* Ações rápidas */}
      <button className="btn btn-success" onClick={() => nav('/customer/agendar')} style={{ marginBottom: 10 }}>
        📅 Agendar horário
      </button>
      <button className="btn btn-ghost" onClick={() => nav('/customer/historico')}>
        🕐 Ver meus agendamentos
      </button>

      {/* Próximos */}
      <span className="label" style={{ marginTop: 20 }}>Meus próximos horários</span>
      <ErrorBox message={error} />
      {loading && <LoadingInline />}
      {!loading && appts.length === 0 && (
        <EmptyState icon="📅" text="Nenhum horário agendado. Que tal agendar agora?" />
      )}
      {appts.map((a) => (
        <div key={a.id} className="card">
          <div className="card-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="card-title">{fmtDateTime(a.starts_at)}</div>
              <div className="card-sub">{a.services}</div>
              <div className="card-sub">✂️ {a.barber_name} — {fmt(a.final_total)}</div>
            </div>
            <StatusTag status={a.status} />
          </div>
        </div>
      ))}

      <div className="spacer-lg" />
    </CustomerLayout>
  );
}
