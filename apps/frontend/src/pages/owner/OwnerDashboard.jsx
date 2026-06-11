/**
 * OwnerDashboard.jsx — Dashboard do dono.
 *
 * GET /dashboard → { revenueToday, profitToday, servicesToday, commissionsToday,
 *                    newCustomersToday, upcoming, topServices, timeline }
 *
 * Exibe: faturamento, lucro real, atendimentos, comissões, novos clientes,
 *        próximos horários, timeline recente.
 * Sem gráficos. Dados reais.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { OwnerLayout } from '../../components/Layout.jsx';
import { LoadingInline, ErrorBox, MetricCard, StatusTag, fmt, fmtDateTime } from '../../components/ui.jsx';
import api from '../../lib/api';
import { connectSocket, getSocket } from '../../lib/socket';

const EVENT_LABEL = {
  checked_in:            '🟢 Walk-in',
  service_completed:     '✅ Concluído',
  appointment_confirmed: '📅 Confirmado',
  appointment_canceled:  '❌ Cancelado',
  appointment_rescheduled:'🔄 Remarcado',
};

export default function OwnerDashboard() {
  const nav = useNavigate();
  const [data, setData]   = useState(null);
  const [loading, setLoad] = useState(true);
  const [error, setError]  = useState('');

  const load = useCallback(async () => {
    setLoad(true); setError('');
    try {
      const d = await api.get('/dashboard');
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally { setLoad(false); }
  }, []);

  useEffect(() => {
    load();

    // Real-time: recarrega dashboard quando algo muda
    const sock = connectSocket();
    sock?.on('dashboard.updated', load);
    sock?.on('appointment.completed', load);
    sock?.on('appointment.checked_in', load);

    return () => {
      const s = getSocket();
      s?.off('dashboard.updated', load);
      s?.off('appointment.completed', load);
      s?.off('appointment.checked_in', load);
    };
  }, [load]);

  const cmpPct = data?.comparativoOntemPct;

  return (
    <OwnerLayout title="📊 Dashboard">
      <ErrorBox message={error} onRetry={load} />
      {loading && <LoadingInline />}

      {data && (
        <>
          {/* ── Métricas principais ── */}
          <span className="label">Hoje</span>
          <div className="metrics">
            <MetricCard
              value={fmt(data.revenueToday)}
              label="Faturamento"
              valueStyle={{ fontSize: 18 }}
            />
            <MetricCard
              value={fmt(data.profitToday)}
              label="Lucro real"
              valueStyle={{ fontSize: 18, color: data.profitToday > 0 ? 'var(--success)' : 'var(--danger)' }}
            />
            <MetricCard value={data.servicesToday}   label="Atendimentos" />
            <MetricCard value={fmt(data.commissionsToday)} label="Comissões" valueStyle={{ fontSize: 18 }} />
          </div>

          {/* Comparativo ontem */}
          {cmpPct !== null && cmpPct !== undefined && (
            <div className={`alert ${cmpPct >= 0 ? 'alert-success' : 'alert-warn'}`}>
              {cmpPct >= 0 ? '📈' : '📉'} {cmpPct >= 0 ? '+' : ''}{cmpPct}% vs. ontem
              ({fmt(data.revenueYesterday)})
            </div>
          )}

          {/* ── Próximos horários ── */}
          {data.upcoming?.length > 0 && (
            <>
              <span className="label">Próximos ({data.upcoming.length})</span>
              {data.upcoming.map((a) => (
                <div
                  key={a.id}
                  className="card card-clickable"
                  onClick={() => nav('/owner/agenda')}
                >
                  <div className="card-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="card-title">{a.customer}</div>
                      <div className="card-sub">{a.services} · {a.barber}</div>
                      <div className="card-sub">{fmtDateTime(a.starts_at)}</div>
                    </div>
                    <StatusTag status={a.status} />
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ── Top serviços hoje ── */}
          {data.topServices?.length > 0 && (
            <>
              <span className="label">Top serviços hoje</span>
              <div className="card">
                {data.topServices.map((s) => (
                  <div key={s.service_name} className="card-row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <span>{s.service_name}</span>
                    <span className="fw-bold">{s.qty}×</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Timeline recente ── */}
          {data.timeline?.length > 0 && (
            <>
              <span className="label">Atividade recente</span>
              <div className="card">
                {data.timeline.map((t) => (
                  <div key={t.id} className="timeline-item">
                    <div className="timeline-dot" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>
                        {EVENT_LABEL[t.event_type] ?? t.event_type}
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                        {t.summary} · {fmtDateTime(t.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Ação rápida */}
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => nav('/owner/financeiro')}>
            Ver financeiro completo →
          </button>
          <div className="spacer-lg" />
        </>
      )}
    </OwnerLayout>
  );
}
