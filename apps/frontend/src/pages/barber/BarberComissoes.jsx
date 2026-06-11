/**
 * BarberComissoes.jsx — Comissões do barbeiro.
 *
 * Mostra: serviços hoje, comissão hoje, comissão do mês, valor a receber.
 * NUNCA mostra lucro da barbearia nem dados de outros barbeiros.
 * Dados de: GET /dashboard/barber (RLS garante isolamento)
 */

import { useEffect, useState } from 'react';
import { BarberLayout } from '../../components/Layout.jsx';
import { LoadingInline, ErrorBox, MetricCard, fmt, fmtDateTime } from '../../components/ui.jsx';
import api from '../../lib/api';

export default function BarberComissoes() {
  const [data, setData]   = useState(null);
  const [loading, setLoad] = useState(true);
  const [error, setError]  = useState('');

  async function load() {
    setLoad(true); setError('');
    try {
      const d = await api.get('/dashboard/barber');
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoad(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <BarberLayout title="💰 Minhas Comissões">
      <ErrorBox message={error} onRetry={load} />
      {loading && <LoadingInline />}

      {data && (
        <>
          {/* Métricas */}
          <div className="metrics">
            <MetricCard
              value={data.servicesToday}
              label="Atendimentos hoje"
            />
            <MetricCard
              value={fmt(data.commissionToday)}
              label="Comissão hoje"
              valueStyle={{ fontSize: 20, color: 'var(--success)' }}
            />
            <MetricCard
              value={fmt(data.commissionMonth)}
              label="Comissão do mês"
              valueStyle={{ fontSize: 18 }}
            />
            <MetricCard
              value={fmt(data.toReceive)}
              label="A receber"
              valueStyle={{ fontSize: 18, color: data.toReceive > 0 ? 'var(--success)' : undefined }}
            />
          </div>

          {/* Próximos agendamentos */}
          {data.upcoming?.length > 0 && (
            <>
              <span className="label">Próximos agendamentos</span>
              {data.upcoming.map((a) => (
                <div key={a.id} className="card">
                  <div className="card-row">
                    <div>
                      <div className="card-title">{a.customer}</div>
                      <div className="card-sub">{a.services}</div>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'right' }}>
                      {fmtDateTime(a.starts_at)}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Histórico */}
          {data.history?.length > 0 && (
            <>
              <span className="label">Últimos atendimentos</span>
              {data.history.map((a) => (
                <div key={a.id} className="card">
                  <div className="card-row">
                    <div>
                      <div className="card-title">{a.customer}</div>
                      <div className="card-sub">{fmtDateTime(a.completed_at)}</div>
                    </div>
                    <div style={{ fontWeight: 700 }}>{fmt(a.final_total)}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      <div className="spacer-lg" />
    </BarberLayout>
  );
}
