/**
 * OwnerAgenda.jsx — Agenda completa (todos os barbeiros).
 *
 * GET /appointments?date=&status= → lista de todos os agendamentos.
 * Ações: iniciar, finalizar, cancelar, remarcar.
 */

import { useState, useCallback } from 'react';
import { OwnerLayout } from '../../components/Layout.jsx';
import {
  LoadingInline, ErrorBox, StatusTag, EmptyState, BottomSheet,
  fmt, fmtTime, fmtDate, todayISO,
} from '../../components/ui.jsx';
import api from '../../lib/api';

const CANCEL_REASONS = [
  { key: 'customer_gave_up',   label: 'Cliente desistiu'    },
  { key: 'customer_no_show',   label: 'Não compareceu'      },
  { key: 'scheduling_error',   label: 'Erro de agendamento' },
  { key: 'internal_problem',   label: 'Problema interno'    },
  { key: 'other',              label: 'Outro'               },
];

const PAY_OPTS = [
  { key: 'pix',    label: '📱 PIX'     },
  { key: 'cash',   label: '💵 Dinheiro' },
  { key: 'debit',  label: '💳 Débito'  },
  { key: 'credit', label: '💳 Crédito' },
];

export default function OwnerAgenda() {
  const [date, setDate]     = useState(todayISO());
  const [appts, setAppts]   = useState([]);
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState('');
  const [loaded, setLoaded] = useState(false);

  // Sheets
  const [completing, setCompleting] = useState(null);
  const [canceling, setCanceling]   = useState(null);
  const [payMethod, setPayMethod]   = useState('pix');
  const [cancelReason, setCancelReason] = useState('');
  const [opLoad, setOpLoad]         = useState(false);

  const load = useCallback(async () => {
    setLoad(true); setError('');
    try {
      const d = await api.get(`/appointments?date=${date}`);
      setAppts(d.data || []);
      setLoaded(true);
    } catch (e) { setError(e.message); }
    finally { setLoad(false); }
  }, [date]);

  async function doStart(id) {
    setOpLoad(true);
    try { await api.patch(`/appointments/${id}/start`); load(); }
    catch (e) { setError(e.message); }
    finally { setOpLoad(false); }
  }

  async function doComplete() {
    if (!completing) return;
    setOpLoad(true);
    try {
      await api.patch(`/appointments/${completing.id}/complete`, { paymentMethod: payMethod });
      setCompleting(null); load();
    } catch (e) { setError(e.message); }
    finally { setOpLoad(false); }
  }

  async function doCancel() {
    if (!canceling || !cancelReason) return;
    setOpLoad(true);
    try {
      await api.patch(`/appointments/${canceling.id}/cancel`, { reason: cancelReason });
      setCanceling(null); setCancelReason(''); load();
    } catch (e) { setError(e.message); }
    finally { setOpLoad(false); }
  }

  // Agrupa por barbeiro
  const byBarber = appts.reduce((acc, a) => {
    const key = a.barber_name ?? 'Sem barbeiro';
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  return (
    <OwnerLayout title="📋 Agenda">
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input type="date" className="input input-sm" value={date}
          onChange={(e) => setDate(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={load} style={{ width: 'auto', padding: '10px 14px' }}>
          {loading ? '...' : 'Ver'}
        </button>
        <button className="btn btn-ghost-muted btn-sm" onClick={() => { setDate(todayISO()); }}
          style={{ width: 'auto', padding: '10px 12px' }}>
          Hoje
        </button>
      </div>

      <ErrorBox message={error} onRetry={load} />
      {loading && <LoadingInline />}

      {loaded && appts.length === 0 && (
        <EmptyState icon="📅" text={`Nenhum agendamento em ${fmtDate(date + 'T00:00:00')}`} />
      )}

      {!loaded && !loading && (
        <div className="alert alert-info">Selecione uma data e toque em "Ver".</div>
      )}

      {Object.entries(byBarber).map(([barber, list]) => (
        <div key={barber}>
          <span className="label">✂️ {barber} ({list.length})</span>
          {list.map((a) => (
            <div key={a.id} className="card" style={a.status === 'in_progress' ? { borderColor: 'var(--fg)', borderWidth: 3 } : {}}>
              <div className="card-row" style={{ marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="card-title">{a.customer_name}</div>
                  <div className="card-sub">{a.services}</div>
                  <div className="card-sub">{fmtTime(a.starts_at)} — {fmt(a.final_total)}</div>
                </div>
                <StatusTag status={a.status} />
              </div>

              {!['completed', 'canceled', 'no_show'].includes(a.status) && (
                <div className="btn-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                  {['scheduled', 'confirmed'].includes(a.status) && (
                    <button className="btn btn-primary btn-sm" onClick={() => doStart(a.id)} disabled={opLoad}>
                      ▶ Iniciar
                    </button>
                  )}
                  {a.status === 'in_progress' && (
                    <button className="btn btn-success btn-sm" onClick={() => { setCompleting(a); setPayMethod('pix'); }}>
                      ✓ Finalizar
                    </button>
                  )}
                  <button className="btn btn-ghost-muted btn-sm" onClick={() => { setCanceling(a); setCancelReason(''); }}>
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {/* Sheet finalizar */}
      <BottomSheet
        open={!!completing}
        onClose={() => setCompleting(null)}
        title="Finalizar atendimento"
        subtitle={completing ? `${completing.customer_name} — ${completing.services}` : ''}
      >
        <span className="label">Pagamento</span>
        <div className="chip-group col2" style={{ marginBottom: 16 }}>
          {PAY_OPTS.map((p) => (
            <button key={p.key} className={`chip ${payMethod === p.key ? 'selected' : ''}`} onClick={() => setPayMethod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => setCompleting(null)}>Voltar</button>
          <button className="btn btn-success" onClick={doComplete} disabled={opLoad}>
            {opLoad ? '...' : `✓ Finalizar`}
          </button>
        </div>
      </BottomSheet>

      {/* Sheet cancelar */}
      <BottomSheet
        open={!!canceling}
        onClose={() => setCanceling(null)}
        title="Cancelar agendamento"
        subtitle={canceling?.customer_name}
      >
        <span className="label">Motivo</span>
        <div className="chip-group col1" style={{ marginBottom: 16 }}>
          {CANCEL_REASONS.map((r) => (
            <button key={r.key} className={`chip ${cancelReason === r.key ? 'selected' : ''}`}
              onClick={() => setCancelReason(r.key)} style={{ padding: '12px' }}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => setCanceling(null)}>Voltar</button>
          <button className="btn btn-danger" onClick={doCancel} disabled={!cancelReason || opLoad}>
            {opLoad ? '...' : 'Cancelar'}
          </button>
        </div>
      </BottomSheet>

      <div className="spacer-lg" />
    </OwnerLayout>
  );
}
