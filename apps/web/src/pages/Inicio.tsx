import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { esSoloAsistente } from '../lib/roles';
import { PreparacionPage } from './inicio/PreparacionPage';

/** Pantalla de teléfono: el menú lateral no cabe. */
export const CONSULTA_CELULAR = '(max-width: 760px)';

function esCelular(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(CONSULTA_CELULAR).matches;
}

/**
 * Página de inicio según el rol: el asistente transversal va a su informe (o, en
 * el celular, a entregar kits a militares); el resto ve la preparación.
 */
export function Inicio() {
  const { user } = useAuth();
  if (esSoloAsistente(user?.roles)) {
    return <Navigate to={esCelular() ? '/custodia/entrega' : '/reportes/cadena-custodia'} replace />;
  }
  return (
    <ProtectedRoute modulo="inicio">
      <PreparacionPage />
    </ProtectedRoute>
  );
}
