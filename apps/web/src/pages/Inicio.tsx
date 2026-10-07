import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { esSoloAsistente } from '../lib/roles';

/** Página de inicio según el rol: el asistente transversal va a su informe. */
export function Inicio() {
  const { user } = useAuth();
  return <Navigate to={esSoloAsistente(user?.roles) ? '/reportes/cadena-custodia' : '/users'} replace />;
}
