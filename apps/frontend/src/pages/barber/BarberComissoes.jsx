import { useEffect, useState } from 'react';
import { BarberLayout } from '../../components/Layout.jsx';
import { LoadingInline, ErrorBox, fmt, fmtDateTime } from '../../components/ui.jsx';
import api from '../../lib/api';

function Card({ value, label, sub, accent, warn }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '14px 10px' }}>
      <div style={{
        fontSize: 22, fontWeight: 900, lineHeight: 1.1,
        color: accent ? 'var(--success)' : warn ? 'var(--danger)' : 'var(--fg)',
      }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600, marginTop: 4 }}>
        {label}
      </div>
      {sub != null && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

function HistoryList({ upcoming, history }) {
  return (
    <>
      {upcoming?.length > 0 && (
        <>
          <span className="label">Próximos agendamentos</span>
          {upcoming.map((a) => (
            <div key={a.id} className="card" style={{ marginBottom: 8 }}>
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
      {history?.length > 0 && (
        <>
          <span className="label">Últimos atendimentos</span>
          {history.map((a) => (
            <div key={a.id} className="card" style={{ marginBottom: 8 }}>
              <div className="card-row">
                <div>
                  <div className="card-title">{a.customer}</div>
                  <div className="card-sub">{fmtDateTime(a.completed_at)}</div>
                </div>
                <div style={{ fontWeight: 700, color: 'var(--success)' }}>{fmt(a.final_total)}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

// ── Vista: Dono ──────────────────────────────────────────────────────────────
function DonoDashboard({ data }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <Card value={data.servicesToday} label="Atendimentos hoje" />
        <Card value={fmt(data.ganhoHoje)} label="Ganho bruto" accent />
      </div>

      {/* Lucro real com breakdown de custos */}
      <div className="card" style={{ marginBottom: 10, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Lucro real hoje
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              Ganho − taxas − insumos
            </div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--success)' }}>
            {fmt(data.lucroRealHoje)}
          </div>
        </div>
        {data.custosHoje > 0 && (
          <div style={{
            marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)',
            fontSize: 12, color: 'var(--muted)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Custos hoje (taxas + insumos)</span>
              <span style={{ color: 'var(--danger)' }}>− {fmt(data.custosHoje)}</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        <Card value={fmt(data.lucroRealMes)} label="Lucro real mês" accent />
        <Card value={fmt(data.toReceive)} label="A receber" accent={data.toReceive > 0} />
      </div>

      <HistoryList upcoming={data.upcoming} history={data.history} />
    </>
  );
}

// ── Vista: Comissionado / Misto ──────────────────────────────────────────────
function ComissionadoDashboard({ data }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <Card value={data.servicesToday} label="Atendimentos hoje" />
        <Card value={fmt(data.commissionToday)} label="Comissão hoje" accent />
      </div>

      {data.remunerationType === 'misto' && data.fixedSalary > 0 && (
        <div className="card" style={{ marginBottom: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Salário fixo mensal
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--fg)' }}>
              {fmt(data.fixedSalary)}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 10, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Lucro hoje
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              Comissão − insumos
            </div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--success)' }}>
            {fmt(data.lucroHoje ?? data.commissionToday)}
          </div>
        </div>
        {data.custosHoje > 0 && (
          <div style={{
            marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)',
          }}>
            <span>Custo de insumos</span>
            <span>− {fmt(data.custosHoje)}</span>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        <Card value={fmt(data.lucroMes ?? data.commissionMonth)} label="Lucro do mês" />
        <Card value={fmt(data.toReceive)} label="A receber" accent={data.toReceive > 0} />
      </div>

      <HistoryList upcoming={data.upcoming} history={data.history} />
    </>
  );
}

// ── Vista: Fixo ──────────────────────────────────────────────────────────────
function FixoDashboard({ data }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <Card value={data.servicesToday} label="Atendimentos hoje" />
        <Card value={fmt(data.fixedSalary)} label="Salário fixo/mês" accent />
      </div>

      <div className="card" style={{ marginBottom: 20, padding: '14px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>
          Remuneração
        </div>
        <div style={{ fontSize: 15, color: 'var(--muted)' }}>
          Salário fixo — sem comissão por atendimento
        </div>
      </div>

      <HistoryList upcoming={data.upcoming} history={data.history} />
    </>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function BarberComissoes() {
  const [data, setData]    = useState(null);
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

  const title = data?.remunerationType === 'dono' ? '📊 Meu Lucro' : '💰 Meus Ganhos';

  return (
    <BarberLayout title={title}>
      <ErrorBox message={error} onRetry={load} />
      {loading && <LoadingInline />}

      {data && (() => {
        const t = data.remunerationType;
        if (t === 'dono') return <DonoDashboard data={data} />;
        if (t === 'fixo') return <FixoDashboard data={data} />;
        return <ComissionadoDashboard data={data} />;
      })()}

      <div className="spacer-lg" />
    </BarberLayout>
  );
}
