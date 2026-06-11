import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { OwnerLayout } from '../../components/Layout.jsx';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── Modais inline ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
      display: 'flex', alignItems: 'flex-end', zIndex: 999,
    }}>
      <div style={{
        background: 'var(--surface)', width: '100%', borderRadius: '18px 18px 0 0',
        padding: '24px 20px 32px', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <strong style={{ fontSize: 17 }}>{title}</strong>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Seção: Serviços ───────────────────────────────────────────────────────────

function ServicosSection() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [err, setErr] = useState('');

  const [form, setForm] = useState({ name: '', durationMinutes: 30, price: '', description: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/services');
      setServices(r.data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditTarget(null);
    setForm({ name: '', durationMinutes: 30, price: '', description: '' });
    setErr('');
    setShowForm(true);
  }

  function openEdit(s) {
    setEditTarget(s);
    setForm({ name: s.name, durationMinutes: s.duration_minutes, price: String(s.price), description: s.description || '' });
    setErr('');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    const body = {
      name: form.name.trim(),
      durationMinutes: Number(form.durationMinutes),
      price: parseFloat(form.price),
      description: form.description.trim() || undefined,
    };
    if (!body.name || isNaN(body.price) || isNaN(body.durationMinutes)) {
      setErr('Preencha nome, duração e preço corretamente.');
      return;
    }
    try {
      if (editTarget) {
        await api.patch(`/services/${editTarget.id}`, body);
      } else {
        await api.post('/services', body);
      }
      setShowForm(false);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function toggleActive(s) {
    try {
      await api.patch(`/services/${s.id}`, { isActive: !s.is_active });
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function handleDelete(s) {
    if (!confirm(`Remover "${s.name}"?`)) return;
    try {
      await api.delete(`/services/${s.id}`);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Serviços</span>
        <button className="btn btn-primary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={openCreate}>
          + Novo
        </button>
      </div>

      {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}

      {loading ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20 }}>Carregando...</p>
      ) : services.length === 0 ? (
        <div className="alert alert-info">Nenhum serviço cadastrado ainda.</div>
      ) : (
        services.map((s) => (
          <div key={s.id} className="card" style={{ marginBottom: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {s.duration_minutes} min · {fmtPrice(s.price)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  onClick={() => toggleActive(s)}
                  style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 20, cursor: 'pointer',
                    background: s.is_active ? '#d1fae5' : '#fee2e2',
                    color: s.is_active ? '#065f46' : '#991b1b',
                  }}
                >
                  {s.is_active ? 'Ativo' : 'Inativo'}
                </span>
                <button onClick={() => openEdit(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>✏️</button>
                <button onClick={() => handleDelete(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>🗑️</button>
              </div>
            </div>
          </div>
        ))
      )}

      {showForm && (
        <Modal title={editTarget ? 'Editar Serviço' : 'Novo Serviço'} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Nome do serviço</label>
              <input className="input" placeholder="Ex: Corte simples" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label>Duração (min)</label>
                <input className="input" type="number" min="5" step="5" value={form.durationMinutes}
                  onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Preço (R$)</label>
                <input className="input" type="number" min="0" step="0.01" placeholder="35.00" value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>Descrição (opcional)</label>
              <input className="input" placeholder="Detalhes do serviço..." value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            {err && <div className="alert alert-danger">{err}</div>}
            <button className="btn btn-primary" type="submit" style={{ width: '100%', marginTop: 8 }}>
              {editTarget ? 'Salvar alterações' : 'Cadastrar serviço'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

const REM_LABELS = {
  dono: 'Dono (100%)',
  comissionado: 'Comissionado (%)',
  fixo: 'Salário fixo',
  misto: 'Fixo + Comissão',
};

const REM_COLORS = {
  dono: { bg: '#dbeafe', color: '#1e40af' },
  comissionado: { bg: '#d1fae5', color: '#065f46' },
  fixo: { bg: '#fef3c7', color: '#92400e' },
  misto: { bg: '#ede9fe', color: '#5b21b6' },
};

// ── Seção: Barbeiros ──────────────────────────────────────────────────────────

function defaultRemForm() {
  return {
    remunerationType: 'comissionado',
    defaultServiceCommissionPct: 50,
    fixedSalary: 0,
    commissionOnCourtesy: false,
    cardFeeDeductedFrom: 'barbershop',
    suppliesDeductedFrom: 'barbershop',
  };
}

function RemForm({ form, setForm }) {
  const rt = form.remunerationType;
  const showPct    = rt === 'comissionado' || rt === 'misto';
  const showSalary = rt === 'fixo' || rt === 'misto';
  const showDeduct = rt === 'comissionado' || rt === 'misto';

  return (
    <>
      <div className="form-group">
        <label>Tipo de remuneração</label>
        <select className="input" value={rt}
          onChange={(e) => setForm({ ...form, remunerationType: e.target.value })}>
          <option value="comissionado">Comissionado (%)</option>
          <option value="dono">Dono — recebe 100% da receita</option>
          <option value="fixo">Salário fixo</option>
          <option value="misto">Fixo + Comissão</option>
        </select>
      </div>

      {showPct && (
        <div className="form-group">
          <label>Comissão sobre serviços (%)</label>
          <input className="input" type="number" min="0" max="100" step="1"
            value={form.defaultServiceCommissionPct}
            onChange={(e) => setForm({ ...form, defaultServiceCommissionPct: Number(e.target.value) })} />
        </div>
      )}

      {showSalary && (
        <div className="form-group">
          <label>Salário fixo mensal (R$)</label>
          <input className="input" type="number" min="0" step="0.01" placeholder="0.00"
            value={form.fixedSalary}
            onChange={(e) => setForm({ ...form, fixedSalary: Number(e.target.value) })} />
        </div>
      )}

      {showDeduct && (
        <>
          <div className="divider" style={{ margin: '10px 0' }} />
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>
            Quem absorve os custos?
          </p>
          <div className="form-group">
            <label>Taxa do cartão</label>
            <select className="input" value={form.cardFeeDeductedFrom}
              onChange={(e) => setForm({ ...form, cardFeeDeductedFrom: e.target.value })}>
              <option value="barbershop">Barbearia (padrão)</option>
              <option value="barber">Desconta da comissão do barbeiro</option>
            </select>
          </div>
          <div className="form-group">
            <label>Custo de insumos</label>
            <select className="input" value={form.suppliesDeductedFrom}
              onChange={(e) => setForm({ ...form, suppliesDeductedFrom: e.target.value })}>
              <option value="barbershop">Barbearia (padrão)</option>
              <option value="barber">Desconta da comissão do barbeiro</option>
            </select>
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" id="commCourtesy" checked={form.commissionOnCourtesy}
              onChange={(e) => setForm({ ...form, commissionOnCourtesy: e.target.checked })} />
            <label htmlFor="commCourtesy" style={{ margin: 0, fontSize: 13 }}>
              Pagar comissão em cortesias
            </label>
          </div>
        </>
      )}
    </>
  );
}

function BarbeirosSection() {
  const [barbers, setBarbers]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [err, setErr]             = useState('');

  const [createForm, setCreateForm] = useState({
    displayName: '', phone: '', email: '', password: '', ...defaultRemForm(),
  });
  const [remForm, setRemForm] = useState(defaultRemForm());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/barbers');
      setBarbers(r.data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setCreateForm({ displayName: '', phone: '', email: '', password: '', ...defaultRemForm() });
    setErr('');
    setShowCreate(true);
  }

  function openEdit(b) {
    setEditTarget(b);
    setRemForm({
      remunerationType: b.remuneration_type || 'comissionado',
      defaultServiceCommissionPct: Number(b.default_service_commission_pct) || 50,
      fixedSalary: Number(b.fixed_salary) || 0,
      commissionOnCourtesy: b.commission_on_courtesy ?? false,
      cardFeeDeductedFrom: b.card_fee_deducted_from || 'barbershop',
      suppliesDeductedFrom: b.supplies_deducted_from || 'barbershop',
    });
    setErr('');
  }

  async function handleCreate(e) {
    e.preventDefault();
    setErr('');
    if (!createForm.displayName.trim()) { setErr('Informe o nome do barbeiro.'); return; }
    if (createForm.email && !createForm.password) { setErr('Informe uma senha para o login.'); return; }
    const pct = createForm.remunerationType === 'dono' ? 100 : createForm.defaultServiceCommissionPct;
    const body = {
      displayName: createForm.displayName.trim(),
      ...(createForm.phone ? { phone: createForm.phone } : {}),
      ...(createForm.email ? { email: createForm.email, password: createForm.password } : {}),
      remunerationType: createForm.remunerationType,
      defaultServiceCommissionPct: pct,
      fixedSalary: createForm.fixedSalary,
      commissionOnCourtesy: createForm.commissionOnCourtesy,
      cardFeeDeductedFrom: createForm.cardFeeDeductedFrom,
      suppliesDeductedFrom: createForm.suppliesDeductedFrom,
    };
    try {
      await api.post('/barbers', body);
      setShowCreate(false);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function handleEditSave(e) {
    e.preventDefault();
    setErr('');
    const pct = remForm.remunerationType === 'dono' ? 100 : remForm.defaultServiceCommissionPct;
    try {
      await api.patch(`/barbers/${editTarget.id}`, {
        remunerationType: remForm.remunerationType,
        defaultServiceCommissionPct: pct,
        fixedSalary: remForm.fixedSalary,
        commissionOnCourtesy: remForm.commissionOnCourtesy,
        cardFeeDeductedFrom: remForm.cardFeeDeductedFrom,
        suppliesDeductedFrom: remForm.suppliesDeductedFrom,
      });
      setEditTarget(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function toggleActive(b) {
    try {
      await api.patch(`/barbers/${b.id}`, { isActive: !b.is_active });
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  const remChip = (rt) => {
    const c = REM_COLORS[rt] || REM_COLORS.comissionado;
    return (
      <span style={{
        fontSize: 10, padding: '2px 7px', borderRadius: 20, fontWeight: 700,
        background: c.bg, color: c.color,
      }}>
        {REM_LABELS[rt] || rt}
      </span>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Barbeiros</span>
        <button className="btn btn-primary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={openCreate}>
          + Novo
        </button>
      </div>

      {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}

      {loading ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20 }}>Carregando...</p>
      ) : barbers.length === 0 ? (
        <div className="alert alert-info">Nenhum barbeiro cadastrado ainda.</div>
      ) : (
        barbers.map((b) => (
          <div key={b.id} className="card" style={{ marginBottom: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>✂️ {b.display_name}</span>
                  {remChip(b.remuneration_type || 'comissionado')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {b.remuneration_type === 'dono' && 'Recebe 100% da receita'}
                  {b.remuneration_type === 'comissionado' && `Comissão: ${b.default_service_commission_pct}%`}
                  {b.remuneration_type === 'fixo' && `Fixo: ${fmtPrice(b.fixed_salary)}/mês`}
                  {b.remuneration_type === 'misto' && `Fixo: ${fmtPrice(b.fixed_salary)} + ${b.default_service_commission_pct}%`}
                  {!b.remuneration_type && `Comissão: ${b.default_service_commission_pct}%`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => openEdit(b)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 4 }}>
                  ⚙️
                </button>
                <span onClick={() => toggleActive(b)} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 20, cursor: 'pointer',
                  background: b.is_active ? '#d1fae5' : '#fee2e2',
                  color: b.is_active ? '#065f46' : '#991b1b',
                }}>
                  {b.is_active ? 'Ativo' : 'Inativo'}
                </span>
              </div>
            </div>
          </div>
        ))
      )}

      {/* Modal: Criar barbeiro */}
      {showCreate && (
        <Modal title="Novo Barbeiro" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>Nome de exibição *</label>
              <input className="input" placeholder="Ex: Carlos" value={createForm.displayName}
                onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Telefone (opcional)</label>
              <input className="input" type="tel" placeholder="11999999999" value={createForm.phone}
                onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} />
            </div>
            <div className="divider" style={{ margin: '12px 0' }} />
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              E-mail + senha para acesso ao app (opcional):
            </p>
            <div className="form-group">
              <label>E-mail de acesso</label>
              <input className="input" type="email" placeholder="barbeiro@email.com" value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
            </div>
            {createForm.email && (
              <div className="form-group">
                <label>Senha</label>
                <input className="input" type="password" placeholder="mínimo 6 caracteres" value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
              </div>
            )}
            <div className="divider" style={{ margin: '12px 0' }} />
            <RemForm form={createForm} setForm={setCreateForm} />
            {err && <div className="alert alert-danger">{err}</div>}
            <button className="btn btn-primary" type="submit" style={{ width: '100%', marginTop: 8 }}>
              Cadastrar barbeiro
            </button>
          </form>
        </Modal>
      )}

      {/* Modal: Editar remuneração */}
      {editTarget && (
        <Modal title={`Remuneração — ${editTarget.display_name}`} onClose={() => setEditTarget(null)}>
          <form onSubmit={handleEditSave}>
            <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px', marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
                Alterar regras afeta apenas <strong>novos atendimentos</strong>.
                Atendimentos concluídos mantêm a regra que estava vigente.
              </p>
            </div>
            <RemForm form={remForm} setForm={setRemForm} />
            {err && <div className="alert alert-danger">{err}</div>}
            <button className="btn btn-primary" type="submit" style={{ width: '100%', marginTop: 12 }}>
              Salvar regras
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

const TABS = [
  { key: 'servicos',  label: '✂️ Serviços' },
  { key: 'barbeiros', label: '👤 Barbeiros' },
  { key: 'perfil',    label: '⚙️ Perfil' },
];

export default function OwnerConfig() {
  const { profile, auth, logout } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState('servicos');

  return (
    <OwnerLayout title="Configurações">
      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 20,
        background: 'var(--surface)', borderRadius: 10, overflow: 'hidden',
        border: '1px solid var(--border)',
      }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: tab === t.key ? 'var(--primary)' : 'transparent',
              color: tab === t.key ? '#fff' : 'var(--muted)',
              transition: 'all .15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'servicos'  && <ServicosSection />}
      {tab === 'barbeiros' && <BarbeirosSection />}

      {tab === 'perfil' && (
        <>
          <div className="card">
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>🏪</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{profile?.name || '—'}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Dono / Gerente</div>
            </div>
            <div className="divider" />
            <div className="profile-item">
              <span className="key">E-mail</span>
              <span>{profile?.email || '—'}</span>
            </div>
            <div className="profile-item">
              <span className="key">Telefone</span>
              <span>{profile?.phone || '—'}</span>
            </div>
          </div>
          <div className="spacer-lg" />
          <button className="btn btn-danger" style={{ width: '100%' }} onClick={() => { logout(); nav('/login'); }}>
            Sair da conta
          </button>
        </>
      )}
    </OwnerLayout>
  );
}
