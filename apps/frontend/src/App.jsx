/**
 * App.jsx — Roteamento principal com guards por perfil.
 *
 * Rotas:
 *   /login            → Login (público)
 *   /barber           → Atendimento Rápido  (role: barber)
 *   /barber/agenda    → Agenda              (role: barber)
 *   /barber/comissoes → Comissões           (role: barber)
 *   /barber/perfil    → Perfil              (role: barber)
 *   /owner            → Dashboard           (role: owner|manager)
 *   /owner/agenda     → Agenda completa     (role: owner|manager)
 *   /owner/financeiro → Financeiro          (role: owner|manager)
 *   /owner/config     → Configurações       (role: owner|manager)
 *   /customer         → Home                (role: customer)
 *   /customer/agendar → Agendamento         (role: customer)
 *   /customer/historico → Histórico         (role: customer)
 *   /customer/perfil  → Perfil              (role: customer)
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { LoadingScreen } from './components/ui.jsx';

// Pages
import Login from './pages/Login.jsx';

import BarberHome      from './pages/barber/BarberHome.jsx';
import BarberAgenda    from './pages/barber/BarberAgenda.jsx';
import BarberComissoes from './pages/barber/BarberComissoes.jsx';
import BarberPerfil    from './pages/barber/BarberPerfil.jsx';

import OwnerDashboard  from './pages/owner/OwnerDashboard.jsx';
import OwnerAgenda     from './pages/owner/OwnerAgenda.jsx';
import OwnerFinanceiro from './pages/owner/OwnerFinanceiro.jsx';
import OwnerConfig     from './pages/owner/OwnerConfig.jsx';

import CustomerHome      from './pages/customer/CustomerHome.jsx';
import CustomerAgendar   from './pages/customer/CustomerAgendar.jsx';
import CustomerHistorico from './pages/customer/CustomerHistorico.jsx';
import CustomerPerfil    from './pages/customer/CustomerPerfil.jsx';

// ── Guard por perfil ──────────────────────────────────────────────────────
function Guard({ roles, children }) {
  const { auth, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!auth) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(auth.role)) return <Navigate to="/login" replace />;
  return children;
}

// ── Redirect pós-login ────────────────────────────────────────────────────
function RoleRedirect() {
  const { auth, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!auth) return <Navigate to="/login" replace />;
  if (auth.role === 'barber')   return <Navigate to="/barber"   replace />;
  if (auth.role === 'owner')    return <Navigate to="/owner"    replace />;
  if (auth.role === 'manager')  return <Navigate to="/owner"    replace />;
  if (auth.role === 'customer') return <Navigate to="/customer" replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return <LoadingScreen />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/"      element={<RoleRedirect />} />

      {/* ── Barbeiro ── */}
      <Route path="/barber" element={
        <Guard roles={['barber']}><BarberHome /></Guard>
      } />
      <Route path="/barber/agenda" element={
        <Guard roles={['barber']}><BarberAgenda /></Guard>
      } />
      <Route path="/barber/comissoes" element={
        <Guard roles={['barber']}><BarberComissoes /></Guard>
      } />
      <Route path="/barber/perfil" element={
        <Guard roles={['barber']}><BarberPerfil /></Guard>
      } />

      {/* ── Dono ── */}
      <Route path="/owner" element={
        <Guard roles={['owner','manager']}><OwnerDashboard /></Guard>
      } />
      <Route path="/owner/agenda" element={
        <Guard roles={['owner','manager']}><OwnerAgenda /></Guard>
      } />
      <Route path="/owner/financeiro" element={
        <Guard roles={['owner','manager']}><OwnerFinanceiro /></Guard>
      } />
      <Route path="/owner/config" element={
        <Guard roles={['owner','manager']}><OwnerConfig /></Guard>
      } />

      {/* ── Cliente ── */}
      <Route path="/customer" element={
        <Guard roles={['customer']}><CustomerHome /></Guard>
      } />
      <Route path="/customer/agendar" element={
        <Guard roles={['customer']}><CustomerAgendar /></Guard>
      } />
      <Route path="/customer/historico" element={
        <Guard roles={['customer']}><CustomerHistorico /></Guard>
      } />
      <Route path="/customer/perfil" element={
        <Guard roles={['customer']}><CustomerPerfil /></Guard>
      } />

      {/* fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
