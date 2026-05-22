import { Navigate, useLocation } from 'react-router-dom';
import type { RoleName } from '@cne/shared-types';
import { useAuth } from './AuthContext';

interface Props {
  children: React.ReactNode;
  roles?: RoleName[];
  allowChangePassword?: boolean;
}

export function ProtectedRoute({ children, roles, allowChangePassword }: Props) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (user.debeCambiarPwd && !allowChangePassword) {
    return <Navigate to="/change-password" replace />;
  }
  if (roles && roles.length > 0 && !roles.some((r) => user.roles.includes(r))) {
    return (
      <div className="center">
        <div className="login-card">
          <h1>Acceso denegado</h1>
          <p className="muted">Tu rol no tiene permisos para esta sección.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
