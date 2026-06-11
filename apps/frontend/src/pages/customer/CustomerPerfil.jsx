/**
 * CustomerPerfil.jsx — Perfil e logout do cliente.
 */

import { useAuth } from '../../context/AuthContext.jsx';
import { CustomerLayout } from '../../components/Layout.jsx';
import { useNavigate } from 'react-router-dom';

export default function CustomerPerfil() {
  const { profile, logout } = useAuth();
  const nav = useNavigate();

  return (
    <CustomerLayout title="👤 Meu Perfil">
      <div className="card">
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>👤</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{profile?.name || '—'}</div>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>Cliente</div>
        </div>
        <div className="divider" />
        <div className="profile-item">
          <span className="key">Telefone</span>
          <span>{profile?.phone || '—'}</span>
        </div>
        <div className="profile-item">
          <span className="key">E-mail</span>
          <span>{profile?.email || '—'}</span>
        </div>
      </div>
      <div className="spacer-lg" />
      <button className="btn btn-danger" onClick={() => { logout(); nav('/login'); }}>
        Sair da conta
      </button>
      <div className="spacer-lg" />
    </CustomerLayout>
  );
}
