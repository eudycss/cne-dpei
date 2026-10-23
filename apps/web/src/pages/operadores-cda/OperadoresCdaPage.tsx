import { useState } from 'react';
import { Pestanas } from '../../components/Pestanas';
import { ListadoOperadores } from './ListadoOperadores';
import { AsistenciaPanel } from './AsistenciaPanel';

const PESTANAS = [
  { id: 'listado', etiqueta: 'Listado' },
  { id: 'asistencia', etiqueta: 'Asistencia' },
] as const;

/**
 * Personal de los Centros de Digitalización de Actas, con el tema "CNE
 * Futurista" de Figma. Se abre en Asistencia, que es el uso diario; cada
 * pestaña pone sus acciones en el encabezado (portal a .ocda-acciones), en el
 * flujo normal: no tapan nada con zoom ni en pantallas angostas.
 */
export function OperadoresCdaPage() {
  const [acciones, setAcciones] = useState<HTMLDivElement | null>(null);
  return (
    <div className="tema-futurista ocda">
      <div className="ocda-encabezado">
        <div>
          <p className="ocda-ruta">Personal / Operadores CDA</p>
          <h2 className="ocda-titulo">Operadores CDA</h2>
          <p className="ocda-subtitulo">
            Registro de entrada y salida del personal de los Centros de Digitalización de Actas.
          </p>
        </div>
        <div className="ocda-acciones" ref={setAcciones} />
      </div>
      <Pestanas pestanas={PESTANAS} porDefecto="asistencia" etiqueta="Secciones de Operadores CDA">
        {(activa) =>
          activa === 'listado' ? <ListadoOperadores acciones={acciones} /> : <AsistenciaPanel acciones={acciones} />
        }
      </Pestanas>
    </div>
  );
}
