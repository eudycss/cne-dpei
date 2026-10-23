import { Navigate, useLocation } from 'react-router';
import type { RoleName } from '@cne/shared-types';
import { MODULOS_WEB, type ModuloWebId } from '@cne/shared-validation';
import { useAuth } from './AuthContext';
import { useModulos } from '../lib/useModulos';

interface Props {
  children: React.ReactNode;
  roles?: RoleName[];
  /** Módulo de la web que el administrador puede ocultar para el rol. */
  modulo?: ModuloWebId;
  allowChangePassword?: boolean;
}

function AccesoDenegado() {
  return (
    <div className="center">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <h1>Acceso denegado</h1>
        <p className="muted">Tu rol no tiene permisos para esta sección.</p>
        <a className="btn secondary" href="/logout" style={{ marginTop: '1rem', display: 'inline-block' }}>
          Cerrar sesión
        </a>
      </div>
    </div>
  );
}

/** Si el módulo está oculto para el rol, lleva al primero que sí puede ver. */
function GuardModulo({ modulo, children }: { modulo: ModuloWebId; children: React.ReactNode }) {
  const { puedeVer, cargando } = useModulos();
  // Esperar la respuesta: con la de fábrica se redirigiría (sin vuelta atrás)
  // a quien el administrador sí le habilitó este módulo.
  if (cargando) {
    return (
      <p className="muted" role="status">
        Cargando…
      </p>
    );
  }
  if (puedeVer(modulo)) return <>{children}</>;
  const destino = MODULOS_WEB.find((m) => m.id !== modulo && puedeVer(m.id));
  return destino ? <Navigate to={destino.ruta} replace /> : <AccesoDenegado />;
}

export function ProtectedRoute({ children, roles, modulo, allowChangePassword }: Props) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (user.debeCambiarPwd && !allowChangePassword) {
    return <Navigate to="/change-password" replace />;
  }
  if (roles && roles.length > 0 && !roles.some((r) => user.roles.includes(r))) {
    return <AccesoDenegado />;
  }
  if (modulo) return <GuardModulo modulo={modulo}>{children}</GuardModulo>;
  return <>{children}</>;
}
