/**
 * CustomerAgendar.jsx — Agendamento pelo cliente.
 *
 * Fluxo: Serviço → Barbeiro → Data → Horário → Confirmar
 *
 * Endpoints:
 *   GET /services          → lista de serviços
 *   GET /barbers           → lista de barbeiros ativos
 *   POST /appointments/hold   → reserva temporária
 *   PATCH /appointments/:id/confirm → confirma
 *
 * Sem endpoint de disponibilidade: gera slots de 30min entre 09:00–19:30,
 * e captura o erro 409 (overbooking) para marcar o slot como indisponível.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CustomerLayout } from '../../components/Layout.jsx';
import {
  LoadingInline, ErrorBox, EmptyState, fmt, fmtDate, fmtTime,
} from '../../components/ui.jsx';
import api from '../../lib/api';

const STEP_LABELS = ['Serviço', 'Barbeiro', 'Data', 'Confirmar'];

// Gera slots de 30min entre openAt e closeAt (ex: '09:00' → '19:30')
function genSlots(date, openAt = '09:00', closeAt = '19:30') {
  const slots = [];
  const [oh, om] = openAt.split(':').map(Number);
  const [ch, cm] = closeAt.split(':').map(Number);
  let h = oh, m = om;
  while (h < ch || (h === ch && m < cm)) {
    slots.push(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
    m += 30;
    if (m >= 60) { h++; m -= 60; }
  }
  return slots;
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

export default function CustomerAgendar() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);  // 0-3

  // Dados
  const [services, setServices]     = useState([]);
  const [barbers, setBarbers]       = useState([]);
  const [loadInit, setLoadInit]     = useState(true);
  const [error, setError]           = useState('');

  // Seleções
  const [selectedService, setService]   = useState(null);
  const [selectedBarber, setBarber]     = useState(null);
  const [selectedDate, setDate]         = useState(todayStr());
  const [selectedSlot, setSlot]         = useState('');
  const [slots, setSlots]               = useState([]);
  const [busySlots, setBusy]            = useState([]);  // slots que falharam com 409

  // Resultado
  const [holdId, setHoldId]     = useState(null);
  const [confirming, setConf]   = useState(false);
  const [done, setDone]         = useState(false);
  const [loading, setLoad]      = useState(false);

  useEffect(() => {
    Promise.all([api.get('/services'), api.get('/barbers')])
      .then(([s, b]) => {
        setServices((s.data || []).filter((x) => x.is_active));
        setBarbers((b.data || []).filter((x) => x.is_active));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadInit(false));
  }, []);

  useEffect(() => {
    if (step === 2 && selectedDate) {
      setSlots(genSlots(selectedDate));
      setSlot('');
    }
  }, [step, selectedDate]);

  // ── Hold + Confirm ────────────────────────────────────────────────────────
  async function doHoldAndConfirm() {
    if (!selectedService || !selectedBarber || !selectedSlot) return;
    setLoad(true); setError('');
    try {
      const hold = await api.post('/appointments/hold', {
        barberId:  selectedBarber.id,
        serviceIds: [selectedService.id],
        startsAt:   selectedSlot,
        idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      setHoldId(hold.id);

      // Confirma imediatamente
      await api.patch(`/appointments/${hold.id}/confirm`);
      setDone(true);
    } catch (e) {
      if (e.status === 409 || e.code === 'overbooking') {
        setBusy((prev) => [...prev, selectedSlot]);
        setError('Horário indisponível. Escolha outro.');
        setSlot('');
      } else {
        setError(e.message);
      }
    } finally { setLoad(false); }
  }

  // ── Tela de sucesso ───────────────────────────────────────────────────────
  if (done) {
    return (
      <CustomerLayout title="Agendado ✅">
        <div className="success-screen">
          <div className="success-icon">✅</div>
          <div className="success-title">Agendado!</div>
          <div style={{ fontSize: 16, color: 'var(--muted)', marginBottom: 4 }}>
            {selectedService?.name} · {selectedBarber?.display_name}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
            {fmtDate(selectedSlot)} · {fmtTime(selectedSlot)}
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--success)', marginBottom: 24 }}>
            {fmt(selectedService?.price)}
          </div>
          <button className="btn btn-primary" onClick={() => nav('/customer')}>
            Voltar ao início
          </button>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => {
            setStep(0); setService(null); setBarber(null);
            setSlot(''); setDone(false); setHoldId(null); setBusy([]);
          }}>
            Agendar outro horário
          </button>
        </div>
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout title="📅 Agendar" back>
      {/* Progress steps */}
      <div className="steps">
        {STEP_LABELS.map((l, i) => (
          <div
            key={l}
            className={`step-item ${i < step ? 'done' : i === step ? 'active' : ''}`}
          >
            <div className="step-circle">{i < step ? '✓' : i + 1}</div>
            {l}
          </div>
        ))}
      </div>

      <ErrorBox message={error} />
      {loadInit && <LoadingInline />}

      {/* ── Step 0: Serviço ── */}
      {step === 0 && !loadInit && (
        <>
          <span className="label">Qual serviço?</span>
          {services.length === 0 && <EmptyState icon="✂️" text="Nenhum serviço disponível" />}
          <div className="chip-group col1">
            {services.map((s) => (
              <button
                key={s.id}
                className="chip"
                style={{ padding: '16px 14px' }}
                onClick={() => { setService(s); setStep(1); }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <span>{s.name}</span>
                  <span style={{ fontWeight: 400, color: 'var(--muted)' }}>
                    {fmt(s.price)} · {s.duration_minutes} min
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Step 1: Barbeiro ── */}
      {step === 1 && (
        <>
          <button className="btn btn-ghost-muted btn-sm" onClick={() => setStep(0)} style={{ marginBottom: 12 }}>
            ‹ {selectedService?.name} — {fmt(selectedService?.price)}
          </button>
          <span className="label">Escolher barbeiro</span>
          {barbers.length === 0 && <EmptyState icon="✂️" text="Nenhum barbeiro disponível" />}
          {barbers.map((b) => (
            <div key={b.id} className="card card-clickable" onClick={() => { setBarber(b); setStep(2); }}>
              <div className="card-row">
                <div>
                  <div className="card-title">✂️ {b.display_name}</div>
                </div>
                <span style={{ color: 'var(--muted)', fontSize: 20 }}>›</span>
              </div>
            </div>
          ))}
          <div className="spacer" />
          <button className="btn btn-ghost-muted btn-sm" onClick={() => {
            setBarber({ id: barbers[0]?.id, display_name: 'Primeiro disponível' });
            setStep(2);
          }}>
            Tanto faz — primeiro disponível
          </button>
        </>
      )}

      {/* ── Step 2: Data e horário ── */}
      {step === 2 && (
        <>
          <button className="btn btn-ghost-muted btn-sm" onClick={() => setStep(1)} style={{ marginBottom: 12 }}>
            ‹ {selectedBarber?.display_name}
          </button>
          <span className="label">Data</span>
          <input
            type="date"
            className="input"
            value={selectedDate}
            min={todayStr()}
            onChange={(e) => setDate(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <span className="label">Horário</span>
          <div className="slot-grid">
            {slots.map((s) => {
              const isBusy = busySlots.includes(s);
              return (
                <button
                  key={s}
                  className={`slot ${selectedSlot === s ? 'selected' : ''}`}
                  disabled={isBusy}
                  onClick={() => setSlot(s)}
                >
                  {fmtTime(s)}
                  {isBusy && <div style={{ fontSize: 9, marginTop: 1 }}>Ocupado</div>}
                </button>
              );
            })}
          </div>
          <div className="spacer-lg" />
          <button
            className={`btn ${selectedSlot ? 'btn-primary' : 'btn-ghost-muted'}`}
            disabled={!selectedSlot || loading}
            onClick={() => setStep(3)}
          >
            Continuar →
          </button>
        </>
      )}

      {/* ── Step 3: Confirmar ── */}
      {step === 3 && (
        <>
          <button className="btn btn-ghost-muted btn-sm" onClick={() => setStep(2)} style={{ marginBottom: 12 }}>
            ‹ Voltar
          </button>
          <div className="card" style={{ border: '2px solid var(--fg)', padding: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Serviço</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedService?.name}</div>
              </div>
              <div className="divider" />
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Barbeiro</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedBarber?.display_name}</div>
              </div>
              <div className="divider" />
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Data e hora</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtDate(selectedSlot)} · {fmtTime(selectedSlot)}</div>
              </div>
              <div className="divider" />
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Valor</div>
                <div style={{ fontSize: 28, fontWeight: 900 }}>{fmt(selectedService?.price)}</div>
              </div>
            </div>
          </div>
          <div className="spacer-lg" />
          <button
            className="btn btn-success"
            onClick={doHoldAndConfirm}
            disabled={loading}
          >
            {loading ? 'Agendando...' : '✓ CONFIRMAR AGENDAMENTO'}
          </button>
        </>
      )}

      <div className="spacer-lg" />
    </CustomerLayout>
  );
}
