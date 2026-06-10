import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Logo } from '../components/Logo';
import { NotificationsBell } from '../components/NotificationsBell';

export function Layout() {
  const { user, logout } = useAuth();
  const puedeVerNotificaciones =
    user?.roles.some((r) => r === 'ADMINISTRADOR' || r === 'TECNICO_SUPERVISOR') ?? false;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo height={44} />
          <h1>CNE Imbabura</h1>
        </div>
        <NavLink to="/users" className={({ isActive }) => (isActive ? 'active' : '')}>
          Usuarios
        </NavLink>
        <NavLink to="/militares" className={({ isActive }) => (isActive ? 'active' : '')}>
          Militares
        </NavLink>
        <NavLink to="/recintos" className={({ isActive }) => (isActive ? 'active' : '')}>
          Recintos Electorales
        </NavLink>
        <NavLink to="/eventos" className={({ isActive }) => (isActive ? 'active' : '')}>
          Eventos Electorales
        </NavLink>
        <NavLink to="/asignaciones" className={({ isActive }) => (isActive ? 'active' : '')}>
          Asignaciones
        </NavLink>
        <NavLink to="/kits" className={({ isActive }) => (isActive ? 'active' : '')}>
          Kits Electorales
        </NavLink>
        <NavLink to="/operadores" className={({ isActive }) => (isActive ? 'active' : '')}>
          Monitoreo
        </NavLink>
        <div className="me">
          <div>
            <strong>{user?.nombres} {user?.apellidos}</strong>
          </div>
          <div style={{ opacity: 0.7 }}>{user?.email}</div>
          <div style={{ marginTop: '0.25rem' }}>
            {user?.roles.map((r) => (
              <span className="badge" key={r}>{r}</span>
            ))}
          </div>
          <button
            className="btn secondary"
            style={{ marginTop: '0.5rem', width: '100%' }}
            onClick={() => logout()}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="main">
        {puedeVerNotificaciones ? (
          <div className="topbar">
            <NotificationsBell />
          </div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
