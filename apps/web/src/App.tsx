import { Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './pages/Login';
import { Logout } from './pages/Logout';
import { ChangePassword } from './pages/ChangePassword';
import { Layout } from './pages/Layout';
import { UsersList } from './pages/users/UsersList';
import { NewUser } from './pages/users/NewUser';
import { BulkUpload } from './pages/users/BulkUpload';
import { MilitaresPage } from './pages/militares/MilitaresPage';
import { BulkMilitares } from './pages/militares/BulkMilitares';
import { EventosPage } from './pages/eventos/EventosPage';
import { AsignacionesPage } from './pages/asignaciones/AsignacionesPage';
import { KitsPage } from './pages/kits/KitsPage';
import { ProtectedRoute } from './auth/ProtectedRoute';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/logout" element={<Logout />} />
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
          <ProtectedRoute roles={['ADMINISTRADOR', 'TECNICO_SUPERVISOR']}>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/users" replace />} />

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

        {/* Eventos electorales */}
        <Route path="/eventos" element={<EventosPage />} />

        {/* Asignaciones operador ↔ supervisor */}
        <Route path="/asignaciones" element={<AsignacionesPage />} />

        {/* Kits electorales */}
        <Route path="/kits" element={<KitsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
