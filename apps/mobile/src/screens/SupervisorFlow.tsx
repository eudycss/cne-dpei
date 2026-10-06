import { FlujoPestanas, ListaPestanas } from '../components/FlujoPestanas';
import { MonitoreoScreen } from './MonitoreoScreen';
import { AlertasScreen } from './AlertasScreen';
import { RecintosDificilAccesoScreen } from './RecintosDificilAccesoScreen';

// La verificación de kits al retorno pasó al rol ASISTENTE_TRANSVERSAL
// (AsistenteFlow): el técnico supervisor solo monitorea.
const PESTANAS: ListaPestanas = [
  { id: 'MONITOREO', label: 'Monitoreo', render: () => <MonitoreoScreen /> },
  { id: 'ALERTAS', label: 'Alertas', render: () => <AlertasScreen /> },
  { id: 'DIFICIL_ACCESO', label: 'Recintos difíciles', render: () => <RecintosDificilAccesoScreen /> },
];

export function SupervisorFlow() {
  return <FlujoPestanas pestanas={PESTANAS} />;
}
