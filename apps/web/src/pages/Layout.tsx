import { NavLink, Outlet } from 'react-router';
import {
  CalendarDays,
  ChartColumn,
  ClipboardList,
  FileChartColumn,
  LogOut,
  MapPinned,
  Moon,
  Network,
  Package,
  School,
  ShieldCheck,
  Siren,
  Sun,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Logo } from '../components/Logo';
import { NotificationsBell } from '../components/NotificationsBell';
import { EnlaceCaidoBanner } from '../components/EnlaceCaidoBanner';
import { useEnlacesCaidosPendientes } from '../lib/useEnlacesCaidosPendientes';
import { etiquetaRol } from '../lib/roles';

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const puedeVerNotificaciones =
    user?.roles.some((r) => r === 'ADMINISTRADOR' || r === 'TECNICO_SUPERVISOR') ?? false;
  // Mismo hook para todos los que pueden ver notificaciones — el banner es
  // full-width, arriba de TODO el layout (sidebar incluido), así nunca tapa
  // los controles del topbar (a diferencia de un position:fixed superpuesto).
  const { pendientes: enlacesPendientes, confirmar: confirmarEnlacesCaidos } =
    useEnlacesCaidosPendientes({ enabled: puedeVerNotificaciones });
  const puedeVerAlertas =
    user?.roles.some((r) => r === 'ADMINISTRADOR' || r === 'TECNICO_SUPERVISOR') ?? false;
  const puedeVerEnlaces = user?.roles.includes('ADMINISTRADOR') ?? false;
  const puedeVerReportes =
    user?.roles.some((r) => r === 'ADMINISTRADOR' || r === 'LECTOR') ?? false;

  return (
    <>
      {enlacesPendientes.length > 0 ? (
        <EnlaceCaidoBanner items={enlacesPendientes} onConfirmar={confirmarEnlacesCaidos} />
      ) : null}
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <Logo height={44} />
            <h1>CNE Imbabura</h1>
          </div>
          <nav className="sidebar-nav" aria-label="Menú principal">
            <NavLink to="/users" className={({ isActive }) => (isActive ? 'active' : '')}>
              <Users size={16} aria-hidden="true" />
              <span>Usuarios</span>
            </NavLink>
            <NavLink to="/militares" className={({ isActive }) => (isActive ? 'active' : '')}>
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Militares</span>
            </NavLink>
            <NavLink to="/recintos" className={({ isActive }) => (isActive ? 'active' : '')}>
              <School size={16} aria-hidden="true" />
              <span>Recintos Electorales</span>
            </NavLink>
            <NavLink to="/eventos" className={({ isActive }) => (isActive ? 'active' : '')}>
              <CalendarDays size={16} aria-hidden="true" />
              <span>Eventos Electorales</span>
            </NavLink>
            <NavLink to="/asignaciones" className={({ isActive }) => (isActive ? 'active' : '')}>
              <ClipboardList size={16} aria-hidden="true" />
              <span>Asignaciones</span>
            </NavLink>
            <NavLink to="/kits" className={({ isActive }) => (isActive ? 'active' : '')}>
              <Package size={16} aria-hidden="true" />
              <span>Kits Electorales</span>
            </NavLink>
            <NavLink to="/operadores" className={({ isActive }) => (isActive ? 'active' : '')}>
              <MapPinned size={16} aria-hidden="true" />
              <span>Monitoreo</span>
            </NavLink>
            <NavLink to="/incidencias" className={({ isActive }) => (isActive ? 'active' : '')}>
              <TriangleAlert size={16} aria-hidden="true" />
              <span>Incidencias</span>
            </NavLink>
            {puedeVerAlertas && (
              <NavLink to="/alertas" className={({ isActive }) => (isActive ? 'active' : '')}>
                <Siren size={16} aria-hidden="true" />
                <span>Alertas</span>
              </NavLink>
            )}
            {puedeVerEnlaces && (
              <NavLink to="/enlaces" className={({ isActive }) => (isActive ? 'active' : '')}>
                <Network size={16} aria-hidden="true" />
                <span>Enlaces</span>
              </NavLink>
            )}
            {puedeVerReportes && (
              <NavLink to="/reportes/no-cda" className={({ isActive }) => (isActive ? 'active' : '')}>
                <FileChartColumn size={16} aria-hidden="true" />
                <span>Reportes</span>
              </NavLink>
            )}
            <NavLink to="/reportes/cdas" className={({ isActive }) => (isActive ? 'active' : '')}>
              <ChartColumn size={16} aria-hidden="true" />
              <span>Power BI CDAS</span>
            </NavLink>
          </nav>
          <div className="me">
            <div>
              <strong>{user?.nombres} {user?.apellidos}</strong>
            </div>
            <div style={{ opacity: 0.7 }}>{user?.email}</div>
            <div style={{ marginTop: '0.25rem' }}>
              {user?.roles.map((r) => (
                <span className="badge" key={r}>{etiquetaRol(r)}</span>
              ))}
            </div>
            <button
              className="btn secondary"
              style={{ marginTop: '0.5rem', width: '100%' }}
              onClick={() => logout()}
            >
              <LogOut size={14} aria-hidden="true" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </aside>
        <main className="main">
          <div className="topbar">
            <button
              className="theme-toggle"
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {puedeVerNotificaciones ? <NotificationsBell /> : null}
          </div>
          <Outlet />
        </main>
      </div>
    </>
  );
}
