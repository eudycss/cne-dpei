import { Navigate, Route, Routes } from 'react-router';
import { Login } from './pages/Login';
import { Logout } from './pages/Logout';
import { ChangePassword } from './pages/ChangePassword';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { FotoCdaPage } from './pages/foto-cda/FotoCdaPage';
import { Layout } from './pages/Layout';
import { UsersList } from './pages/users/UsersList';
import { NewUser } from './pages/users/NewUser';
import { BulkUpload } from './pages/users/BulkUpload';
import { MilitaresPage } from './pages/militares/MilitaresPage';
import { BulkMilitares } from './pages/militares/BulkMilitares';
import { OperadoresCdaPage } from './pages/operadores-cda/OperadoresCdaPage';
import { RecintosSeccion } from './pages/recintos/RecintosSeccion';
import { EventosPage } from './pages/eventos/EventosPage';
import { AsignacionesPage } from './pages/asignaciones/AsignacionesPage';
import { KitsPage } from './pages/kits/KitsPage';
import { MonitoreoPage } from './pages/operadores/MonitoreoPage';
import { IncidenciasPage } from './pages/incidencias/IncidenciasPage';
import { AlertasPage } from './pages/alertas/AlertasPage';
import { ReporteNoCdaPage } from './pages/reportes/ReporteNoCdaPage';
import { CadenaCustodiaPage } from './pages/reportes/CadenaCustodiaPage';
import { Inicio } from './pages/Inicio';
import { PowerBiCdasPage } from './pages/reportes/PowerBiCdasPage';
import { ProtectedRoute } from './auth/ProtectedRoute';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/logout" element={<Logout />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Pública: el operador CDA sube su foto con su enlace personal (token en el #). */}
      <Route path="/foto-cda" element={<FotoCdaPage />} />
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
          <ProtectedRoute roles={['ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'LECTOR', 'ASISTENTE_TRANSVERSAL']}>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Inicio />} />

        {/* Usuarios */}
        <Route path="/users" element={<UsersList />} />
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
        <Route path="/militares" element={<MilitaresPage />} />
        <Route
          path="/militares/upload"
          element={
            <ProtectedRoute roles={['ADMINISTRADOR']}>
              <BulkMilitares />
            </ProtectedRoute>
          }
        />

        {/* Recintos electorales */}
        <Route path="/recintos" element={<RecintosSeccion />} />

        {/* Eventos electorales */}
        <Route path="/eventos" element={<EventosPage />} />

        {/* Asignaciones operador ↔ supervisor */}
        <Route path="/asignaciones" element={<AsignacionesPage />} />

        {/* Kits electorales */}
        <Route path="/kits" element={<KitsPage />} />

        {/* Monitoreo de operadores en retorno (HU6) */}
        <Route path="/operadores" element={<MonitoreoPage />} />

        {/* CDAs: Operadores y Asistentes CDA (asistencia, foto y actas) */}
        <Route
          path="/operadores-cda"
          element={
            <ProtectedRoute roles={['ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL']}>
              <OperadoresCdaPage />
            </ProtectedRoute>
          }
        />
        {/* Incidencias (HU14) */}
        <Route path="/incidencias" element={<IncidenciasPage />} />
        {/* Alertas (HU18) — fuera del alcance de LECTOR */}
        <Route
          path="/alertas"
          element={
            <ProtectedRoute roles={['ADMINISTRADOR', 'TECNICO_SUPERVISOR']}>
              <AlertasPage />
            </ProtectedRoute>
          }
        />

        {/* Enlaces caídos: ahora es una pestaña de Recintos (solo Administrador) */}
        <Route path="/enlaces" element={<Navigate to="/recintos?tab=enlaces" replace />} />

        {/* Reporte admin de NO-CDAs pendientes */}
        <Route
          path="/reportes/no-cda"
          element={
            <ProtectedRoute roles={['ADMINISTRADOR', 'LECTOR']}>
              <ReporteNoCdaPage />
            </ProtectedRoute>
          }
        />

        {/* Cadena de custodia de kits (acta por kit) */}
        <Route
          path="/reportes/cadena-custodia"
          element={
            <ProtectedRoute roles={['ADMINISTRADOR', 'LECTOR', 'ASISTENTE_TRANSVERSAL']}>
              <CadenaCustodiaPage />
            </ProtectedRoute>
          }
        />

        {/* Reporte Power BI "Proyecto CDAS" — el acceso real lo controla Power BI */}
        <Route path="/reportes/cdas" element={<PowerBiCdasPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
