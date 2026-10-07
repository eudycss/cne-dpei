import { FlujoPestanas, ListaPestanas } from '../components/FlujoPestanas';
import { EntregaMilitarScreen } from './EntregaMilitarScreen';
import { VerificacionDpiScreen } from './VerificacionDpiScreen';
import { KitsVerificadosScreen } from './KitsVerificadosScreen';

// Asistente Electoral Transversal: custodia de los kits en el DPEI, en el orden
// de la jornada (entrega al militar → retorno del CDA).
const PESTANAS: ListaPestanas = [
  { id: 'ENTREGAR', label: 'Entregar a militar', render: () => <EntregaMilitarScreen /> },
  { id: 'VERIFICAR_RETORNO', label: 'Verificar retorno', render: () => <VerificacionDpiScreen /> },
  { id: 'VERIFICADOS', label: 'Verificados', render: () => <KitsVerificadosScreen /> },
];

export function AsistenteFlow() {
  return <FlujoPestanas pestanas={PESTANAS} />;
}
