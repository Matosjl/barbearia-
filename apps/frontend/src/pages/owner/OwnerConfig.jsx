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

// ── Seção: Barbeiros ──────────────────────────────────────────────────────────

function BarbeirosSection() {
  const [barbers, setBarbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ displayName: '', phone: '', email: '', password: '' });

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
    setForm({ displayName: '', phone: '', email: '', password: '' });
    setErr('');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    if (!form.displayName.trim()) { setErr('Informe o nome do barbeiro.'); return; }
    if (form.email && !form.password) { setErr('Informe uma senha para o login do barbeiro.'); return; }
    const body = {
      displayName: form.displayName.trim(),
      ...(form.phone ? { phone: form.phone } : {}),
      ...(form.email ? { email: form.email, password: form.password } : {}),
    };
    try {
      await api.post('/barbers', body);
      setShowForm(false);
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>✂️ {b.display_name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Comissão: {b.default_service_commission_pct}%
                </div>
              </div>
              <span
                onClick={() => toggleActive(b)}
                style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 20, cursor: 'pointer',
                  background: b.is_active ? '#d1fae5' : '#fee2e2',
                  color: b.is_active ? '#065f46' : '#991b1b',
                }}
              >
                {b.is_active ? 'Ativo' : 'Inativo'}
              </span>
            </div>
          </div>
        ))
      )}

      {showForm && (
        <Modal title="Novo Barbeiro" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Nome de exibição *</label>
              <input className="input" placeholder="Ex: Carlos" value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Telefone (opcional)</label>
              <input className="input" type="tel" placeholder="11999999999" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="divider" style={{ margin: '12px 0' }} />
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              Preencha e-mail + senha para dar acesso ao app do barbeiro (opcional):
            </p>
            <div className="form-group">
              <label>E-mail de acesso</label>
              <input className="input" type="email" placeholder="barbeiro@email.com" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            {form.email && (
              <div className="form-group">
                <label>Senha</label>
                <input className="input" type="password" placeholder="mínimo 6 caracteres" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            )}
            {err && <div className="alert alert-danger">{err}</div>}
            <button className="btn btn-primary" type="submit" style={{ width: '100%', marginTop: 8 }}>
              Cadastrar barbeiro
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
