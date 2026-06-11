/**
 * CustomerHistorico.jsx — Histórico de agendamentos do cliente.
 * GET /appointments/mine → lista todos (incluindo passados).
 * Permite cancelar agendamentos futuros.
 */

import { useState, useEffect } from 'react';
import { CustomerLayout } from '../../components/Layout.jsx';
import {
  LoadingInline, ErrorBox, StatusTag, EmptyState, BottomSheet,
  fmt, fmtDateTime,
} from '../../components/ui.jsx';
import api from '../../lib/api';

const CANCEL_REASONS = [
  { key: 'customer_gave_up', label: 'Desisti'              },
  { key: 'other',            label: 'Outro motivo'         },
];

export default function CustomerHistorico() {
  const [appts, setAppts]     = useState([]);
  const [loading, setLoad]    = useState(true);
  const [error, setError]     = useState('');
  const [canceling, setCanceling] = useState(null);
  const [reason, setReason]   = useState('');
  const [opLoad, setOpLoad]   = useState(false);

  function load() {
    setLoad(true);
    api.get('/appointments/mine')
      .then((d) => setAppts(d.data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoad(false));
  }

  useEffect(() => { load(); }, []);

  async function doCancel() {
    if (!canceling || !reason) return;
    setOpLoad(true);
    try {
      await api.patch(`/appointments/${canceling.id}/cancel`, { reason });
      setCanceling(null); setReason('');
      load();
    } catch (e) { setError(e.message); }
    finally { setOpLoad(false); }
  }

  const upcoming = appts.filter((a) => ['pending_hold', 'scheduled', 'confirmed', 'in_progress'].includes(a.status));
  const past     = appts.filter((a) => ['completed', 'canceled', 'no_show'].includes(a.status));

  return (
    <CustomerLayout title="🕐 Meus Agendamentos">
      <ErrorBox message={error} onRetry={load} />
      {loading && <LoadingInline />}

      {/* Próximos */}
      {upcoming.length > 0 && (
        <>
          <span className="label">Próximos ({upcoming.length})</span>
          {upcoming.map((a) => (
            <div key={a.id} className="card">
              <div className="card-row" style={{ marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="card-title">{fmtDateTime(a.starts_at)}</div>
                  <div className="card-sub">{a.services}</div>
                  <div className="card-sub">✂️ {a.barber_name} — {fmt(a.final_total)}</div>
                </div>
                <StatusTag status={a.status} />
              </div>
              {['scheduled', 'confirmed', 'pending_hold'].includes(a.status) && (
                <button
                  className="btn btn-ghost-muted btn-sm"
                  onClick={() => { setCanceling(a); setReason(''); }}
                  style={{ marginTop: 4 }}
                >
                  Cancelar
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {/* Histórico */}
      {past.length > 0 && (
        <>
          <span className="label">Histórico ({past.length})</span>
          {past.map((a) => (
            <div key={a.id} className="card">
              <div className="card-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="card-title">{fmtDateTime(a.starts_at)}</div>
                  <div className="card-sub">{a.services} · ✂️ {a.barber_name}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <StatusTag status={a.status} />
                  {a.status === 'completed' && <span style={{ fontWeight: 700, fontSize: 14 }}>{fmt(a.final_total)}</span>}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {!loading && appts.length === 0 && (
        <EmptyState icon="📅" text="Você ainda não tem agendamentos." />
      )}

      {/* Sheet cancelar */}
      <BottomSheet
        open={!!canceling}
        onClose={() => setCanceling(null)}
        title="Cancelar agendamento"
        subtitle={canceling ? fmtDateTime(canceling.starts_at) : ''}
      >
        <span className="label">Motivo</span>
        <div className="chip-group col1" style={{ marginBottom: 16 }}>
          {CANCEL_REASONS.map((r) => (
            <button key={r.key} className={`chip ${reason === r.key ? 'selected' : ''}`}
              onClick={() => setReason(r.key)} style={{ padding: '14px' }}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => setCanceling(null)}>Voltar</button>
          <button className="btn btn-danger" onClick={doCancel} disabled={!reason || opLoad}>
            {opLoad ? '...' : 'Cancelar horário'}
          </button>
        </div>
      </BottomSheet>

      <div className="spacer-lg" />
    </CustomerLayout>
  );
}
