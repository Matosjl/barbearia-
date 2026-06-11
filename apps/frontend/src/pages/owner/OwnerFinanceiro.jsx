/**
 * OwnerFinanceiro.jsx — Financeiro completo do dono.
 *
 * Endpoints:
 *   GET /financial/summary?from=&to=  → { grossRevenue, commission, cardFee, supplies, otherExpense, refunds, realProfit }
 *   GET /financial/dre?from=&to=      → DRE linha a linha
 *   GET /financial/transactions?from=&to= → extrato
 *   GET /financial/barber-commissions?from=&to= → comissões por barbeiro
 */

import { useState, useCallback } from 'react';
import { OwnerLayout } from '../../components/Layout.jsx';
import { LoadingInline, ErrorBox, fmt, fmtDate } from '../../components/ui.jsx';
import api from '../../lib/api';

const todayStr = () => new Date().toISOString().slice(0, 10);

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function OwnerFinanceiro() {
  const [from, setFrom]       = useState(firstOfMonth());
  const [to, setTo]           = useState(todayStr());
  const [tab, setTab]         = useState('resumo');   // 'resumo' | 'dre' | 'extrato' | 'comissoes'

  const [summary, setSummary]         = useState(null);
  const [dre, setDre]                 = useState(null);
  const [transactions, setTx]         = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoad]            = useState(false);
  const [error, setError]             = useState('');

  const query = `?from=${from}&to=${to}`;

  const load = useCallback(async () => {
    setLoad(true); setError('');
    try {
      if (tab === 'resumo') {
        const d = await api.get(`/financial/summary${query}`);
        setSummary(d);
      } else if (tab === 'dre') {
        const d = await api.get(`/financial/dre${query}`);
        setDre(d);
      } else if (tab === 'extrato') {
        const d = await api.get(`/financial/transactions${query}`);
        setTx(d.data || []);
      } else if (tab === 'comissoes') {
        const d = await api.get(`/financial/barber-commissions${query}`);
        setCommissions(d.data || []);
      }
    } catch (e) {
      setError(e.message);
    } finally { setLoad(false); }
  }, [tab, from, to]);

  return (
    <OwnerLayout title="💰 Financeiro">
      {/* Filtro de período */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} style={{ flex: 1 }} />
        <span style={{ alignSelf: 'center', color: 'var(--muted)', flexShrink: 0 }}>→</span>
        <input type="date" className="input input-sm" value={to}   onChange={(e) => setTo(e.target.value)}   style={{ flex: 1 }} />
      </div>

      {/* Sub-tabs */}
      <div className="tab-group" style={{ marginBottom: 12 }}>
        {[
          { key: 'resumo',    label: 'Resumo'    },
          { key: 'dre',       label: 'DRE'       },
          { key: 'extrato',   label: 'Extrato'   },
          { key: 'comissoes', label: 'Comissões' },
        ].map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
            style={{ fontSize: 12 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <button className="btn btn-primary btn-sm" onClick={load} disabled={loading} style={{ marginBottom: 12 }}>
        {loading ? 'Carregando...' : '🔍 Consultar'}
      </button>

      <ErrorBox message={error} />
      {loading && <LoadingInline />}

      {/* ── Resumo ── */}
      {tab === 'resumo' && summary && (
        <>
          <div className="card" style={{ padding: 20 }}>
            <LineItem label="Receita bruta"  value={summary.grossRevenue} big />
            <div className="divider" />
            <LineItem label="− Comissões"    value={-summary.commission}  neg />
            <LineItem label="− Taxa cartão"  value={-summary.cardFee}     neg />
            <LineItem label="− Insumos"      value={-summary.supplies}    neg />
            <LineItem label="− Outras desp." value={-summary.otherExpense} neg />
            <LineItem label="− Estornos"     value={-summary.refunds}     neg />
            <div className="divider" />
            <LineItem label="Lucro real" value={summary.realProfit} big profit />
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {summary.services} atendimentos no período.
          </div>
        </>
      )}

      {/* ── DRE ── */}
      {tab === 'dre' && dre && (
        <div className="card" style={{ padding: 20 }}>
          <LineItem label="Faturamento bruto"    value={dre.faturamentoBruto}  big />
          <div className="divider" />
          <LineItem label="(−) Comissões"        value={-dre.menosComissao}    neg />
          <LineItem label="(−) Taxa de cartão"   value={-dre.menosTaxaCartao}  neg />
          <LineItem label="(−) Insumos / CMV"    value={-dre.menosInsumos}     neg />
          <LineItem label="(−) Outras despesas"  value={-dre.menosDespesas}    neg />
          <div className="divider" />
          <LineItem label="= LUCRO REAL"         value={dre.lucroReal}         big profit />
        </div>
      )}

      {/* ── Extrato ── */}
      {tab === 'extrato' && transactions.length > 0 && (
        <>
          {transactions.map((t) => (
            <div key={t.id} className="card">
              <div className="card-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="card-title" style={{ fontSize: 14 }}>
                    {CATEGORY_LABEL[t.category] ?? t.category}
                    {t.is_courtesy && ' 🎁'}
                  </div>
                  <div className="card-sub">{fmtDate(t.occurred_on)} · {t.method ?? '—'}</div>
                </div>
                <div style={{ fontWeight: 700, color: t.direction === 'in' ? 'var(--success)' : 'var(--danger)' }}>
                  {t.direction === 'in' ? '+' : '−'}{fmt(t.amount)}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'extrato' && !loading && transactions.length === 0 && (
        <div className="alert alert-info">Nenhuma transação no período.</div>
      )}

      {/* ── Comissões por barbeiro ── */}
      {tab === 'comissoes' && commissions.length > 0 && (
        <>
          {commissions.map((c) => (
            <div key={c.barber_id} className="card">
              <div className="card-row">
                <div>
                  <div className="card-title">{c.display_name}</div>
                  <div className="card-sub">{c.items} atendimentos</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700 }}>{fmt(c.total)}</div>
                  <div style={{ fontSize: 12, color: 'var(--success)' }}>a receber: {fmt(c.to_receive)}</div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'comissoes' && !loading && commissions.length === 0 && (
        <div className="alert alert-info">Nenhuma comissão no período.</div>
      )}

      <div className="spacer-lg" />
    </OwnerLayout>
  );
}

function LineItem({ label, value, big, neg, profit }) {
  const abs = Math.abs(Number(value ?? 0));
  const color = profit
    ? (abs >= 0 ? 'var(--success)' : 'var(--danger)')
    : neg && abs > 0
      ? 'var(--danger)'
      : 'var(--fg)';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
      <span style={{ fontSize: big ? 15 : 14, color: big ? 'var(--fg)' : 'var(--muted)' }}>{label}</span>
      <span style={{ fontWeight: big ? 900 : 600, fontSize: big ? 16 : 14, color }}>
        {neg && abs > 0 ? '−' : ''}{fmt(abs)}
      </span>
    </div>
  );
}

const CATEGORY_LABEL = {
  service:    'Serviço',
  commission: 'Comissão',
  card_fee:   'Taxa cartão',
  supplies:   'Insumos',
  refund:     'Estorno',
  expense:    'Despesa',
};
