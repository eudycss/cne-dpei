import { FlujoPestanas, ListaPestanas } from '../components/FlujoPestanas';
import { VerificacionDpiScreen } from './VerificacionDpiScreen';
import { KitsVerificadosScreen } from './KitsVerificadosScreen';

// Asistente Electoral Transversal: custodia de los kits en el DPEI.
const PESTANAS: ListaPestanas = [
  { id: 'VERIFICAR_RETORNO', label: 'Verificar retorno', render: () => <VerificacionDpiScreen /> },
  { id: 'VERIFICADOS', label: 'Verificados', render: () => <KitsVerificadosScreen /> },
];

export function AsistenteFlow() {
  return <FlujoPestanas pestanas={PESTANAS} />;
}
