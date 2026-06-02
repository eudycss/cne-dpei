import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function Logout() {
  const { user, logout } = useAuth();

  useEffect(() => {
    if (user) logout();
  }, [user, logout]);

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="center">
      <div className="login-card">
        <h1>Cerrando sesión…</h1>
      </div>
    </div>
  );
}
