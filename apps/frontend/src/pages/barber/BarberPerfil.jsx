/**
 * BarberPerfil.jsx — Perfil do barbeiro com botão de logout.
 */

import { useAuth } from '../../context/AuthContext.jsx';
import { BarberLayout } from '../../components/Layout.jsx';
import { useNavigate } from 'react-router-dom';

export default function BarberPerfil() {
  const { profile, auth, logout } = useAuth();
  const nav = useNavigate();

  function handleLogout() {
    logout();
    nav('/login');
  }

  return (
    <BarberLayout title="👤 Meu Perfil">
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>✂️</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{profile?.name || '—'}</div>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>Barbeiro</div>
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
        <div className="profile-item">
          <span className="key">Barbearia</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{auth?.barbershopId?.slice(0, 8)}...</span>
        </div>
      </div>

      <div className="spacer-lg" />
      <button className="btn btn-danger" onClick={handleLogout}>Sair da conta</button>
      <div className="spacer-lg" />
    </BarberLayout>
  );
}
