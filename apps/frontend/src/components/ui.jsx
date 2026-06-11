/**
 * ui.jsx — Componentes compartilhados reutilizáveis.
 * Pequenos e focados. Sem lógica de negócio.
 */

// ── Loading ──────────────────────────────────────────────────────────────
export function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="spinner" />
      <span>Carregando...</span>
    </div>
  );
}

export function LoadingInline({ text = 'Carregando...' }) {
  return (
    <div className="loading-inline">
      <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
      <span>{text}</span>
    </div>
  );
}

// ── Error ────────────────────────────────────────────────────────────────
export function ErrorBox({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="error-box">
      ⚠️ {message}
      {onRetry && (
        <button
          onClick={onRetry}
          style={{ marginLeft: 8, background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', color: 'inherit', fontSize: 'inherit' }}
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}

// ── Status Tag ───────────────────────────────────────────────────────────
const STATUS_MAP = {
  pending_hold: { label: 'Reservado',    cls: 'tag-yellow' },
  scheduled:    { label: 'Agendado',     cls: 'tag-blue'   },
  confirmed:    { label: 'Confirmado',   cls: 'tag-green'  },
  in_progress:  { label: 'Em andamento', cls: 'tag-dark'   },
  completed:    { label: 'Concluído',    cls: 'tag-green'  },
  canceled:     { label: 'Cancelado',    cls: 'tag-red'    },
  no_show:      { label: 'Faltou',       cls: 'tag-red'    },
};

export function StatusTag({ status }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: 'tag-gray' };
  return <span className={`tag ${s.cls}`}>{s.label}</span>;
}

// ── Payment Tag ──────────────────────────────────────────────────────────
const PAY_MAP = {
  cash:    { label: '💵 Dinheiro', cls: 'tag-gray'  },
  pix:     { label: '📱 PIX',      cls: 'tag-green' },
  debit:   { label: '💳 Débito',   cls: 'tag-blue'  },
  credit:  { label: '💳 Crédito',  cls: 'tag-blue'  },
  credits: { label: '🎫 Crédito',  cls: 'tag-blue'  },
  free:    { label: '🎁 Cortesia', cls: 'tag-yellow' },
};

export function PayTag({ method }) {
  const p = PAY_MAP[method] ?? { label: method, cls: 'tag-gray' };
  return <span className={`tag ${p.cls}`}>{p.label}</span>;
}

// ── Currency ─────────────────────────────────────────────────────────────
export function Fmt({ value }) {
  const n = Number(value ?? 0);
  return <span>R$ {n.toFixed(2).replace('.', ',')}</span>;
}

export function fmt(value) {
  return `R$ ${Number(value ?? 0).toFixed(2).replace('.', ',')}`;
}

// ── Date / Time ──────────────────────────────────────────────────────────
export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── BottomSheet Overlay ──────────────────────────────────────────────────
export function BottomSheet({ open, onClose, title, subtitle, children }) {
  if (!open) return null;
  return (
    <div className={`overlay ${open ? 'open' : ''}`} onClick={onClose}>
      <div className="overlay-sheet" onClick={(e) => e.stopPropagation()}>
        {title && <div className="overlay-title">{title}</div>}
        {subtitle && <div className="overlay-sub">{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

// ── Confirm Sheet ────────────────────────────────────────────────────────
export function ConfirmSheet({ open, onClose, onConfirm, title, subtitle, confirmLabel = 'Confirmar', confirmCls = 'btn btn-primary', loading }) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="btn-row">
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className={confirmCls} onClick={onConfirm} disabled={loading}>
          {loading ? '...' : confirmLabel}
        </button>
      </div>
    </BottomSheet>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────
export function EmptyState({ icon = '📋', text }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 15 }}>{text}</div>
    </div>
  );
}

// ── Metric Card ──────────────────────────────────────────────────────────
export function MetricCard({ value, label, valueStyle }) {
  return (
    <div className="metric-card">
      <div className="metric-value" style={valueStyle}>{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}
