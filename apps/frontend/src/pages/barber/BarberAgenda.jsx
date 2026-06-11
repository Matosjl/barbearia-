/**
 * BarberAgenda.jsx — Agenda do barbeiro (somente os próprios agendamentos, via RLS).
 *
 * Ações disponíveis por status:
 *   scheduled / confirmed → Iniciar | Cancelar | Remarcar
 *   in_progress           → Finalizar | Cancelar
 *   completed / canceled  → somente visualização
 *
 * Também inclui botão "Cliente na hora" → vai para /barber (Atendimento Rápido)
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarberLayout } from '../../components/Layout.jsx';
import {
  LoadingInline, ErrorBox, StatusTag, EmptyState,
  BottomSheet, fmt, fmtTime, fmtDate, todayISO,
} from '../../components/ui.jsx';
import api from '../../lib/api';

const CANCEL_REASONS = [
  { key: 'customer_gave_up',  label: 'Cliente desistiu'    },
  { key: 'customer_no_show',  label: 'Cliente não apareceu'},
  { key: 'scheduling_error',  label: 'Erro de agendamento' },
  { key: 'internal_problem',  label: 'Problema interno'    },
  { key: 'other',             label: 'Outro motivo'        },
];

const PAY_OPTS = [
  { key: 'pix',    label: '📱 PIX'     },
  { key: 'cash',   label: '💵 Dinheiro' },
  { key: 'debit',  label: '💳 Débito'  },
  { key: 'credit', label: '💳 Crédito' },
];

export default function BarberAgenda() {
  const nav = useNavigate();

  const [date, setDate]         = useState(todayISO());
  const [appts, setAppts]       = useState([]);
  const [loading, setLoad]      = useState(true);
  const [error, setError]       = useState('');

  // Sheets
  const [completing, setCompleting]   = useState(null);  // appointment being completed
  const [canceling, setCanceling]     = useState(null);  // appointment being canceled
  const [cancelReason, setCancelReason] = useState('');
  const [payMethod, setPayMethod]     = useState('pix');
  const [opLoad, setOpLoad]           = useState(false);

  const load = useCallback(async () => {
    setLoad(true); setError('');
    try {
      const d = await api.get(`/appointments?date=${date}`);
      setAppts(d.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoad(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  // ── Ações ───────────────────────────────────────────────────────────────

  async function doStart(id) {
    setOpLoad(true);
    try {
      await api.patch(`/appointments/${id}/start`);
      load();
    } catch (e) { setError(e.message); }
    finally { setOpLoad(false); }
  }

  async function doComplete() {
    if (!completing || !payMethod) return;
    setOpLoad(true);
    try {
      await api.patch(`/appointments/${completing.id}/complete`, { paymentMethod: payMethod });
      setCompleting(null);
      load();
    } catch (e) { setError(e.message); }
    finally { setOpLoad(false); }
  }

  async function doCancel() {
    if (!canceling || !cancelReason) return;
    setOpLoad(true);
    try {
      await api.patch(`/appointments/${canceling.id}/cancel`, { reason: cancelReason });
      setCanceling(null); setCancelReason('');
      load();
    } catch (e) { setError(e.message); }
    finally { setOpLoad(false); }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const inProgress = appts.filter((a) => a.status === 'in_progress');
  const upcoming   = appts.filter((a) => ['scheduled', 'confirmed'].includes(a.status));
  const done       = appts.filter((a) => ['completed', 'canceled', 'no_show'].includes(a.status));

  return (
    <BarberLayout title="📋 Minha Agenda">
      {/* Seletor de data */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <input
          type="date"
          className="input input-sm"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary btn-sm" onClick={() => setDate(todayISO())} style={{ width: 'auto', padding: '10px 14px' }}>
          Hoje
        </button>
      </div>

      <button className="btn btn-ghost btn-sm" onClick={() => nav('/barber')} style={{ marginBottom: 12 }}>
        + Cliente na hora (walk-in)
      </button>

      <ErrorBox message={error} onRetry={load} />
      {loading && <LoadingInline />}

      {!loading && appts.length === 0 && (
        <EmptyState icon="📅" text={`Nenhum agendamento para ${fmtDate(date + 'T00:00:00')}`} />
      )}

      {/* Em andamento */}
      {inProgress.length > 0 && (
        <>
          <span className="label">Em andamento</span>
          {inProgress.map((a) => (
            <AppointmentCard
              key={a.id}
              appt={a}
              onComplete={() => { setCompleting(a); setPayMethod('pix'); }}
              onCancel={() => { setCanceling(a); setCancelReason(''); }}
            />
          ))}
        </>
      )}

      {/* Próximos */}
      {upcoming.length > 0 && (
        <>
          <span className="label">Próximos ({upcoming.length})</span>
          {upcoming.map((a) => (
            <AppointmentCard
              key={a.id}
              appt={a}
              onStart={() => doStart(a.id)}
              onCancel={() => { setCanceling(a); setCancelReason(''); }}
              opLoading={opLoad}
            />
          ))}
        </>
      )}

      {/* Realizados */}
      {done.length > 0 && (
        <>
          <span className="label">Realizados ({done.length})</span>
          {done.map((a) => (
            <AppointmentCard key={a.id} appt={a} />
          ))}
        </>
      )}

      {/* Sheet: Finalizar */}
      <BottomSheet
        open={!!completing}
        onClose={() => setCompleting(null)}
        title="Finalizar atendimento"
        subtitle={completing ? `${completing.customer_name} — ${completing.services}` : ''}
      >
        <span className="label">Forma de pagamento</span>
        <div className="chip-group col2" style={{ marginBottom: 16 }}>
          {PAY_OPTS.map((p) => (
            <button
              key={p.key}
              className={`chip ${payMethod === p.key ? 'selected' : ''}`}
              onClick={() => setPayMethod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => setCompleting(null)}>Cancelar</button>
          <button className="btn btn-success" onClick={doComplete} disabled={opLoad}>
            {opLoad ? 'Finalizando...' : `✓ Finalizar — ${fmt(completing?.final_total)}`}
          </button>
        </div>
      </BottomSheet>

      {/* Sheet: Cancelar */}
      <BottomSheet
        open={!!canceling}
        onClose={() => setCanceling(null)}
        title="Cancelar agendamento"
        subtitle={canceling ? `${canceling.customer_name}` : ''}
      >
        <span className="label">Motivo</span>
        <div className="chip-group col1" style={{ marginBottom: 16 }}>
          {CANCEL_REASONS.map((r) => (
            <button
              key={r.key}
              className={`chip ${cancelReason === r.key ? 'selected' : ''}`}
              onClick={() => setCancelReason(r.key)}
              style={{ padding: '12px' }}
            >
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
    </BarberLayout>
  );
}

// ── Card de agendamento ────────────────────────────────────────────────────
function AppointmentCard({ appt, onStart, onComplete, onCancel, opLoading }) {
  const canStart    = ['scheduled', 'confirmed'].includes(appt.status);
  const canFinish   = appt.status === 'in_progress';
  const canCancel   = !['completed', 'canceled', 'no_show'].includes(appt.status);
  const isDone      = ['completed', 'canceled', 'no_show'].includes(appt.status);

  return (
    <div className="card" style={canFinish ? { borderColor: 'var(--fg)', borderWidth: 3 } : {}}>
      <div className="card-row" style={{ marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card-title">{appt.customer_name}</div>
          <div className="card-sub">{appt.services}</div>
          <div className="card-sub">{fmtTime(appt.starts_at)} — {fmt(appt.final_total)}</div>
        </div>
        <StatusTag status={appt.status} />
      </div>

      {!isDone && (
        <div className="btn-row" style={{ marginTop: 8 }}>
          {canStart && (
            <button className="btn btn-primary btn-sm" onClick={onStart} disabled={opLoading}>
              ▶ Iniciar
            </button>
          )}
          {canFinish && (
            <button className="btn btn-success btn-sm" onClick={onComplete}>
              ✓ Finalizar
            </button>
          )}
          {canCancel && (
            <button className="btn btn-ghost-muted btn-sm" onClick={onCancel}>
              Cancelar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
