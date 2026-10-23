import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import {
  ChartColumn,
  FileChartColumn,
  ListChecks,
  LogOut,
  MapPinned,
  Moon,
  Siren,
  Sun,
  TriangleAlert,
  PackageCheck,
  IdCard,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Logo } from '../components/Logo';
import { NotificationsBell } from '../components/NotificationsBell';
import { esSoloAsistente, etiquetaRol } from '../lib/roles';
import { PASOS_PREPARACION } from '../lib/flujo';

/** Grupo del menú con título visible, anunciado como grupo por lectores de pantalla. */
function SeccionMenu({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="sidebar-seccion">
      <div id={id} className="sidebar-seccion-titulo">{titulo}</div>
      {children}
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const puedeVerNotificaciones =
    user?.roles.some((r) => r === 'ADMINISTRADOR' || r === 'TECNICO_SUPERVISOR') ?? false;
  const puedeVerAlertas =
    user?.roles.some((r) => r === 'ADMINISTRADOR' || r === 'TECNICO_SUPERVISOR') ?? false;
  const puedeVerReportes =
    user?.roles.some((r) => r === 'ADMINISTRADOR' || r === 'LECTOR') ?? false;
  const puedeVerCustodia =
    user?.roles.some((r) => r === 'ADMINISTRADOR' || r === 'LECTOR' || r === 'ASISTENTE_TRANSVERSAL') ?? false;
  // El asistente transversal solo usa la cadena de custodia en la web; el resto
  // de páginas consulta endpoints que no le corresponden.
  const soloAsistente = esSoloAsistente(user?.roles);
  const puedeVerInformes = puedeVerCustodia || puedeVerReportes || !soloAsistente;
  const puedeVerOperadoresCda =
    user?.roles.some((r) => r === 'ADMINISTRADOR' || r === 'TECNICO_SUPERVISOR' || r === 'ASISTENTE_TRANSVERSAL') ??
    false;

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <Logo height={44} />
            <h1>CNE Imbabura</h1>
          </div>
          <nav className="sidebar-nav" aria-label="Menú principal">
            {!soloAsistente && (
              <>
                <SeccionMenu id="menu-preparacion" titulo="Preparación">
                  <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
                    <ListChecks size={16} aria-hidden="true" />
                    <span>Estado de la preparación</span>
                  </NavLink>
                  {PASOS_PREPARACION.map(({ id, ruta, etiqueta, icono: Icono }) => (
                    <NavLink key={id} to={ruta} className={({ isActive }) => (isActive ? 'active' : '')}>
                      <Icono size={16} aria-hidden="true" />
                      <span>{etiqueta}</span>
                    </NavLink>
                  ))}
                </SeccionMenu>
                <SeccionMenu id="menu-operacion" titulo="Operación">
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
                </SeccionMenu>
              </>
            )}
            {puedeVerOperadoresCda && (
              <SeccionMenu id="menu-personal" titulo="Personal">
                <NavLink to="/operadores-cda" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <IdCard size={16} aria-hidden="true" />
                  <span>Operadores CDA</span>
                </NavLink>
              </SeccionMenu>
            )}
            {puedeVerInformes && (
              <SeccionMenu id="menu-informes" titulo="Informes">
                {puedeVerCustodia && (
                  <NavLink to="/reportes/cadena-custodia" className={({ isActive }) => (isActive ? 'active' : '')}>
                    <PackageCheck size={16} aria-hidden="true" />
                    <span>Cadena de custodia</span>
                  </NavLink>
                )}
                {puedeVerReportes && (
                  <NavLink to="/reportes/no-cda" className={({ isActive }) => (isActive ? 'active' : '')}>
                    <FileChartColumn size={16} aria-hidden="true" />
                    <span>Reportes</span>
                  </NavLink>
                )}
                {!soloAsistente && (
                  <NavLink to="/reportes/cdas" className={({ isActive }) => (isActive ? 'active' : '')}>
                    <ChartColumn size={16} aria-hidden="true" />
                    <span>Power BI CDAS</span>
                  </NavLink>
                )}
              </SeccionMenu>
            )}
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
