import { Pestanas } from '../../components/Pestanas';
import { ListadoOperadores } from './ListadoOperadores';
import { AsistenciaPanel } from './AsistenciaPanel';

const PESTANAS = [
  { id: 'listado', etiqueta: 'Listado' },
  { id: 'asistencia', etiqueta: 'Asistencia' },
] as const;

/**
 * Personal de los Centros de Digitalización de Actas. Se abre en Asistencia,
 * que es el uso diario; el Listado tiene los datos y la importación del Excel.
 */
export function OperadoresCdaPage() {
  return (
    <>
      <h2 style={{ marginBottom: '0.25rem' }}>Operadores CDA</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Personal de los Centros de Digitalización de Actas.
      </p>
      <Pestanas pestanas={PESTANAS} porDefecto="asistencia" etiqueta="Secciones de Operadores CDA">
        {(activa) => (activa === 'listado' ? <ListadoOperadores /> : <AsistenciaPanel />)}
      </Pestanas>
    </>
  );
}
