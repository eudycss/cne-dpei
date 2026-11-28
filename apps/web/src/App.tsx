import { Navigate, Route, Routes } from 'react-router';
import { Login } from './pages/Login';
import { Logout } from './pages/Logout';
import { ChangePassword } from './pages/ChangePassword';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Layout } from './pages/Layout';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { CargaDePagina } from './components/CargaDePagina';
import { lazyPage } from './lib/lazy-page';
import { ROLES_ENTREGA_MILITAR } from './lib/roles';

// Cada página va en su propio archivo .js y se descarga al entrar a ella: el
// login y el armazón (Layout) no cargan MapLibre, Excel ni PDF de golpe.
const FotoCdaPage = lazyPage(() => import('./pages/foto-cda/FotoCdaPage'), 'FotoCdaPage');
const UsersList = lazyPage(() => import('./pages/users/UsersList'), 'UsersList');
const NewUser = lazyPage(() => import('./pages/users/NewUser'), 'NewUser');
const BulkUpload = lazyPage(() => import('./pages/users/BulkUpload'), 'BulkUpload');
const MilitaresPage = lazyPage(() => import('./pages/militares/MilitaresPage'), 'MilitaresPage');
const BulkMilitares = lazyPage(() => import('./pages/militares/BulkMilitares'), 'BulkMilitares');
const OperadoresCdaPage = lazyPage(() => import('./pages/operadores-cda/OperadoresCdaPage'), 'OperadoresCdaPage');
const RecintosSeccion = lazyPage(() => import('./pages/recintos/RecintosSeccion'), 'RecintosSeccion');
const EventosPage = lazyPage(() => import('./pages/eventos/EventosPage'), 'EventosPage');
const AsignacionesPage = lazyPage(() => import('./pages/asignaciones/AsignacionesPage'), 'AsignacionesPage');
const KitsPage = lazyPage(() => import('./pages/kits/KitsPage'), 'KitsPage');
const MonitoreoPage = lazyPage(() => import('./pages/operadores/MonitoreoPage'), 'MonitoreoPage');
const EstadisticasMonitoreoPage = lazyPage(() => import('./pages/operadores/EstadisticasMonitoreoPage'), 'EstadisticasMonitoreoPage');
const IncidenciasPage = lazyPage(() => import('./pages/incidencias/IncidenciasPage'), 'IncidenciasPage');
const AlertasPage = lazyPage(() => import('./pages/alertas/AlertasPage'), 'AlertasPage');
const PlanPerimetroPage = lazyPage(() => import('./pages/plan-perimetro/PlanPerimetroPage'), 'PlanPerimetroPage');
const ReporteNoCdaPage = lazyPage(() => import('./pages/reportes/ReporteNoCdaPage'), 'ReporteNoCdaPage');
const LlegadaDpeiPage = lazyPage(() => import('./pages/reportes/LlegadaDpeiPage'), 'LlegadaDpeiPage');
const CadenaCustodiaPage = lazyPage(() => import('./pages/reportes/CadenaCustodiaPage'), 'CadenaCustodiaPage');
const Inicio = lazyPage(() => import('./pages/Inicio'), 'Inicio');
const PowerBiCdasPage = lazyPage(() => import('./pages/reportes/PowerBiCdasPage'), 'PowerBiCdasPage');
const PermisosModulosPage = lazyPage(() => import('./pages/permisos-modulos/PermisosModulosPage'), 'PermisosModulosPage');
const SimuladorPage = lazyPage(() => import('./pages/simulador/SimuladorPage'), 'SimuladorPage');
const SimuladorPublicoPage = lazyPage(() => import('./pages/simulador-publico/SimuladorPublicoPage'), 'SimuladorPublicoPage');
const EvaticsPublicoPage = lazyPage(() => import('./pages/evatics-publico/EvaticsPublicoPage'), 'EvaticsPublicoPage');
const InformeCdaPage = lazyPage(() => import('./pages/informe-cda/InformeCdaPage'), 'InformeCdaPage');
const EntregaMilitarPage = lazyPage(() => import('./pages/custodia/EntregaMilitarPage'), 'EntregaMilitarPage');

export default function App() {
  return (
    <CargaDePagina>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/logout" element={<Logout />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* Pública: el operador CDA sube su foto con su enlace personal (token en el #). */}
        <Route path="/foto-cda" element={<FotoCdaPage />} />
        {/* Pública: práctica de digitación; se entra con la cédula. */}
        <Route path="/simulador" element={<SimuladorPublicoPage />} />
        {/* Pública: subir el certificado Evatics con la cédula. */}
        <Route path="/evatics" element={<EvaticsPublicoPage />} />
        {/* Pública: el personal CDA/CPE sube 6 fotos y descarga su informe de productos. */}
        <Route path="/informe-cda" element={<InformeCdaPage />} />
        {/* Entrega de kits a militares desde el celular (Asistente con iPhone): sin menú lateral, cabe en el teléfono. */}
        <Route
          path="/custodia/entrega"
          element={
            <ProtectedRoute roles={ROLES_ENTREGA_MILITAR}>
              <EntregaMilitarPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/change-password"
          element={
            <ProtectedRoute allowChangePassword>
              <ChangePassword />
            </ProtectedRoute>
          }
        />
        <Route
          element={
            <ProtectedRoute roles={['ADMINISTRADOR', 'ANALISTA_PROVINCIAL', 'TECNICO_SUPERVISOR', 'LECTOR', 'ASISTENTE_TRANSVERSAL']}>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Inicio />} />

          {/* Usuarios */}
          <Route
            path="/users"
            element={
              <ProtectedRoute modulo="usuarios">
                <UsersList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users/new"
            element={
              <ProtectedRoute roles={['ADMINISTRADOR']}>
                <NewUser />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users/upload"
            element={
              <ProtectedRoute roles={['ADMINISTRADOR']}>
                <BulkUpload />
              </ProtectedRoute>
            }
          />

          {/* Militares */}
          <Route
            path="/militares"
            element={
              <ProtectedRoute modulo="militares">
                <MilitaresPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/militares/upload"
            element={
              <ProtectedRoute roles={['ADMINISTRADOR']}>
                <BulkMilitares />
              </ProtectedRoute>
            }
          />

          {/* Recintos electorales */}
          <Route
            path="/recintos"
            element={
              <ProtectedRoute modulo="recintos">
                <RecintosSeccion />
              </ProtectedRoute>
            }
          />

          {/* Eventos electorales */}
          <Route
            path="/eventos"
            element={
              <ProtectedRoute modulo="eventos">
                <EventosPage />
              </ProtectedRoute>
            }
          />

          {/* Asignaciones operador ↔ supervisor */}
          <Route
            path="/asignaciones"
            element={
              <ProtectedRoute modulo="asignaciones">
                <AsignacionesPage />
              </ProtectedRoute>
            }
          />

          {/* Kits electorales */}
          <Route
            path="/kits"
            element={
              <ProtectedRoute modulo="kits">
                <KitsPage />
              </ProtectedRoute>
            }
          />

          {/* Monitoreo de operadores en retorno (HU6) */}
          <Route
            path="/operadores"
            element={
              <ProtectedRoute modulo="monitoreo">
                <MonitoreoPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/operadores/estadisticas"
            element={
              <ProtectedRoute modulo="monitoreo">
                <EstadisticasMonitoreoPage />
              </ProtectedRoute>
            }
          />

          {/* CDAs: Operadores y Asistentes CDA (asistencia, foto y actas) */}
          <Route
            path="/operadores-cda"
            element={
              <ProtectedRoute roles={['ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL']} modulo="operadores-cda">
                <OperadoresCdaPage />
              </ProtectedRoute>
            }
          />
          {/* Simulador de digitación: de fábrica solo Administrador; se activa a otros roles por módulo */}
          <Route
            path="/simulador-digitacion"
            element={
              <ProtectedRoute roles={['ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL']} modulo="simulador-digitacion">
                <SimuladorPage />
              </ProtectedRoute>
            }
          />
          {/* Incidencias (HU14) */}
          <Route
            path="/incidencias"
            element={
              <ProtectedRoute modulo="incidencias">
                <IncidenciasPage />
              </ProtectedRoute>
            }
          />
          {/* Alertas (HU18) — fuera del alcance de LECTOR */}
          <Route
            path="/alertas"
            element={
              <ProtectedRoute roles={['ADMINISTRADOR', 'TECNICO_SUPERVISOR']} modulo="alertas">
                <AlertasPage />
              </ProtectedRoute>
            }
          />

          {/* Plan de perímetro: puestos del personal CDA/CPE, vallas y zonas sobre el mapa */}
          <Route
            path="/plan-perimetro"
            element={
              <ProtectedRoute roles={['ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL']} modulo="plan-perimetro">
                <PlanPerimetroPage />
              </ProtectedRoute>
            }
          />

          {/* Enlaces caídos: ahora es una pestaña de Recintos (solo Administrador) */}
          <Route path="/enlaces" element={<Navigate to="/recintos?tab=enlaces" replace />} />

          {/* Reporte admin de NO-CDAs pendientes */}
          <Route
            path="/reportes/no-cda"
            element={
              <ProtectedRoute roles={['ADMINISTRADOR', 'LECTOR']} modulo="reportes">
                <ReporteNoCdaPage />
              </ProtectedRoute>
            }
          />

          {/* Llegada de los CDA a la DPEI (los mismos roles que Reportes › Flujo) */}
          <Route
            path="/reportes/llegada-dpei"
            element={
              <ProtectedRoute roles={['ADMINISTRADOR', 'LECTOR']} modulo="reportes">
                <LlegadaDpeiPage />
              </ProtectedRoute>
            }
          />

          {/* Cadena de custodia de kits (acta por kit): la ve el rol al que el admin se la active */}
          <Route
            path="/reportes/cadena-custodia"
            element={
              <ProtectedRoute modulo="cadena-custodia">
                <CadenaCustodiaPage />
              </ProtectedRoute>
            }
          />

          {/* Reporte Power BI "Proyecto CDAS" — el acceso real lo controla Power BI */}
          <Route
            path="/reportes/cdas"
            element={
              <ProtectedRoute modulo="powerbi-cdas">
                <PowerBiCdasPage />
              </ProtectedRoute>
            }
          />

          {/* Administración: qué módulos de la web ve cada rol */}
          <Route
            path="/configuracion/modulos"
            element={
              <ProtectedRoute roles={['ADMINISTRADOR']}>
                <PermisosModulosPage />
              </ProtectedRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </CargaDePagina>
  );
}
