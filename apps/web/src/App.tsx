import { Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './pages/Login';
import { ChangePassword } from './pages/ChangePassword';
import { Layout } from './pages/Layout';
import { UsersList } from './pages/users/UsersList';
import { NewUser } from './pages/users/NewUser';
import { BulkUpload } from './pages/users/BulkUpload';
import { ProtectedRoute } from './auth/ProtectedRoute';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
