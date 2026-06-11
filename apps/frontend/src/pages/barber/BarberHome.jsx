/**
 * BarberHome.jsx — ATENDIMENTO RÁPIDO (walk-in)
 *
 * TELA MAIS IMPORTANTE DO SISTEMA.
 * Fluxo: Nome → Telefone → Serviço(s) → Pagamento → Finalizar
 * Meta: menos de 10 segundos do início ao fim.
 *
 * Ao tocar FINALIZAR:
 *   1. POST /appointments/walk-in  → cria com status in_progress
 *   2. PATCH /appointments/:id/complete → finaliza com pagamento
 * Tudo automático. Barbeiro não vê complexidade.
 */

import { useState, useEffect, useRef } from 'react';
import { BarberLayout } from '../../components/Layout.jsx';
import { ErrorBox, fmt, LoadingInline } from '../../components/ui.jsx';
import api from '../../lib/api';

const PAYMENT_OPTS = [
  { key: 'pix',    label: '📱 PIX'     },
  { key: 'cash',   label: '💵 Dinheiro' },
  { key: 'debit',  label: '💳 Débito'  },
  { key: 'credit', label: '💳 Crédito' },
];

// ── Tela de sucesso após finalizar ────────────────────────────────────────
function SuccessScreen({ result, customerName, onNext }) {
  return (
    <div className="success-screen">
      <div className="success-icon">✅</div>
      <div className="success-title">Finalizado!</div>
      <div style={{ fontSize: 16, color: 'var(--muted)', marginBottom: 4 }}>{customerName}</div>
      <div style={{ fontSize: 36, fontWeight: 900, color: 'var(--success)', marginBottom: 4 }}>
        {fmt(result.finalTotal)}
      </div>
      <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24 }}>
        Comissão: {fmt(result.commission)}
      </div>
      <button className="btn btn-primary" onClick={onNext}>
        Próximo atendimento →
      </button>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────
export default function BarberHome() {
  const nameRef = useRef(null);

  // Formulário
  const [name, setName]         = useState('');
  const [phone, setPhone]       = useState('');
  const [services, setServices] = useState([]);       // catálogo
  const [selected, setSelected] = useState([]);       // ids selecionados
  const [payment, setPayment]   = useState('');

  // Estados
  const [loadSvc, setLoadSvc]   = useState(true);
  const [loading, setLoad]      = useState(false);
  const [error, setError]       = useState('');
  const [result, setResult]     = useState(null);     // resposta de /complete

  // Carrega serviços ativos ao montar
  useEffect(() => {
    api.get('/services')
      .then((d) => setServices((d.data || []).filter((s) => s.is_active)))
      .catch(() => setError('Erro ao carregar serviços'))
      .finally(() => setLoadSvc(false));
  }, []);

  // Auto-focus no nome
  useEffect(() => {
    if (!result) nameRef.current?.focus();
  }, [result]);

  function reset() {
    setName(''); setPhone(''); setSelected([]); setPayment('');
    setResult(null); setError('');
    setTimeout(() => nameRef.current?.focus(), 100);
  }

  function toggleService(id) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const totalPrice = services
    .filter((s) => selected.includes(s.id))
    .reduce((sum, s) => sum + Number(s.price), 0);

  const canFinish = name.trim() && phone.trim() && selected.length > 0 && payment;

  async function handleFinish() {
    if (!canFinish) return;
    setLoad(true); setError('');

    try {
      // 1 — Walk-in (cria in_progress automaticamente)
      const walkin = await api.post('/appointments/walk-in', {
        customerName: name.trim(),
        phone: phone.trim(),
        serviceIds: selected,
        idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });

      // 2 — Complete (comissão + financeiro + tudo automático)
      const completed = await api.patch(`/appointments/${walkin.id}/complete`, {
        paymentMethod: payment,
      });

      setResult({ ...completed, customerName: name.trim() });
    } catch (err) {
      setError(err.message || 'Erro ao finalizar');
    } finally {
      setLoad(false);
    }
  }

  // ── Tela de sucesso ────────────────────────────────────────────────────
  if (result) {
    return (
      <BarberLayout title="Concluído ✅">
        <SuccessScreen
          result={result}
          customerName={result.customerName}
          onNext={reset}
        />
      </BarberLayout>
    );
  }

  // ── Formulário principal ───────────────────────────────────────────────
  return (
    <BarberLayout title="⚡ Atendimento Rápido">
      <div>
        <ErrorBox message={error} />

        {/* Nome */}
        <span className="label">Nome do cliente *</span>
        <input
          ref={nameRef}
          className="input"
          type="text"
          placeholder="Digite o nome..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />

        {/* Telefone */}
        <span className="label">Telefone *</span>
        <input
          className="input input-sm"
          type="tel"
          placeholder="(11) 99999-9999"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
        />

        {/* Serviços */}
        <span className="label">
          Serviço * {selected.length > 0 && <span style={{ color: 'var(--fg)' }}>— {fmt(totalPrice)}</span>}
        </span>

        {loadSvc ? (
          <LoadingInline text="Carregando serviços..." />
        ) : (
          <div className="chip-group col2">
            {services.map((s) => (
              <button
                key={s.id}
                className={`chip ${selected.includes(s.id) ? 'selected' : ''}`}
                onClick={() => toggleService(s.id)}
              >
                {s.name}
                <span className="price">{fmt(s.price)}</span>
              </button>
            ))}
          </div>
        )}

        {/* Pagamento */}
        <span className="label">Pagamento *</span>
        <div className="chip-group col2">
          {PAYMENT_OPTS.map((p) => (
            <button
              key={p.key}
              className={`chip ${payment === p.key ? 'selected' : ''}`}
              onClick={() => setPayment(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="spacer-lg" />

        <button
          className={`btn ${canFinish ? 'btn-success' : 'btn-ghost-muted'}`}
          onClick={handleFinish}
          disabled={!canFinish || loading}
        >
          {loading
            ? 'Finalizando...'
            : canFinish
              ? `✓ FINALIZAR — ${fmt(totalPrice)}`
              : 'Preencha os campos obrigatórios'}
        </button>

        <div className="spacer-lg" />
      </div>
    </BarberLayout>
  );
}
