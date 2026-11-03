import { FlujoPestanas, ListaPestanas } from '../components/FlujoPestanas';
import { EntregaMilitarScreen } from './EntregaMilitarScreen';
import { VerificacionDpiScreen } from './VerificacionDpiScreen';
import { RetornoKitsScreen } from './RetornoKitsScreen';

// Asistente Electoral Transversal: custodia de los kits en el DPEI, en el orden
// de la jornada (entrega al militar → retorno del CDA → quién falta llegar).
const PESTANAS: ListaPestanas = [
  { id: 'ENTREGAR', label: 'Entregar a militar', render: () => <EntregaMilitarScreen /> },
  { id: 'VERIFICAR_RETORNO', label: 'Verificar retorno', render: () => <VerificacionDpiScreen /> },
  { id: 'RETORNO', label: 'Retorno', render: () => <RetornoKitsScreen /> },
];

export function AsistenteFlow() {
  return <FlujoPestanas pestanas={PESTANAS} />;
}
