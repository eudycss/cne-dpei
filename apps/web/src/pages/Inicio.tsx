import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { esSoloAsistente } from '../lib/roles';
import { PreparacionPage } from './inicio/PreparacionPage';

/** Página de inicio según el rol: el asistente transversal va a su informe; el resto ve la preparación. */
export function Inicio() {
  const { user } = useAuth();
  if (esSoloAsistente(user?.roles)) return <Navigate to="/reportes/cadena-custodia" replace />;
  return <PreparacionPage />;
}
