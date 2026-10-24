import { useState } from 'react';
import type { GrupoCda } from '@cne/shared-types';
import { Pestanas } from '../../components/Pestanas';
import { ListadoOperadores } from './ListadoOperadores';
import { AsistenciaPanel } from './AsistenciaPanel';
import { ActasPanel } from './ActasPanel';
import { AtrasosPanel } from './AtrasosPanel';
import { GrupoCdaContext, TEXTOS_GRUPO } from './grupo';

const GRUPOS = [
  { id: 'operadores', etiqueta: TEXTOS_GRUPO.OPERADOR.titulo },
  { id: 'asistentes', etiqueta: TEXTOS_GRUPO.ASISTENTE.titulo },
] as const;

const GRUPO_DE: Record<(typeof GRUPOS)[number]['id'], GrupoCda> = { operadores: 'OPERADOR', asistentes: 'ASISTENTE' };

const SECCIONES = [
  { id: 'listado', etiqueta: 'Listado' },
  { id: 'asistencia', etiqueta: 'Asistencia' },
  { id: 'atrasos', etiqueta: 'Atrasos' },
  { id: 'actas', etiqueta: 'Actas de entrega' },
] as const;

/**
 * Personal de los Centros de Digitalización de Actas, con el tema "CNE
 * Futurista" de Figma. Dos niveles de pestañas: el grupo (Operadores o
 * Asistentes CDA, en ?grupo=) y la sección (en ?tab=). Los dos grupos usan
 * los mismos componentes: el grupo les llega por GrupoCdaContext. Se abre en
 * Operadores CDA > Asistencia, que es el uso diario. Cada pestaña pone sus
 * acciones en el encabezado (portal a .ocda-acciones), en el flujo normal:
 * no tapan nada con zoom ni en pantallas angostas.
 */
export function OperadoresCdaPage() {
  const [acciones, setAcciones] = useState<HTMLDivElement | null>(null);
  return (
    <div className="tema-futurista ocda">
      <div className="ocda-encabezado">
        <div>
          <p className="ocda-ruta">Personal / CDAs</p>
          <h2 className="ocda-titulo">CDAs</h2>
          <p className="ocda-subtitulo">
            Asistencia, atrasos, fotos y actas de entrega del personal de los Centros de Digitalización de Actas.
          </p>
        </div>
        <div className="ocda-acciones" ref={setAcciones} />
      </div>
      <Pestanas pestanas={GRUPOS} porDefecto="operadores" etiqueta="Grupos del personal CDA" parametro="grupo">
        {(activo) => (
          // key: al cambiar de grupo se montan de nuevo (sin fechas ni búsquedas del otro grupo).
          <GrupoCdaContext.Provider key={activo} value={GRUPO_DE[activo]}>
            <Pestanas pestanas={SECCIONES} porDefecto="asistencia" etiqueta={`Secciones de ${TEXTOS_GRUPO[GRUPO_DE[activo]].titulo}`}>
              {(seccion) =>
                seccion === 'listado' ? (
                  <ListadoOperadores acciones={acciones} />
                ) : seccion === 'atrasos' ? (
                  <AtrasosPanel acciones={acciones} />
                ) : seccion === 'actas' ? (
                  <ActasPanel acciones={acciones} />
                ) : (
                  <AsistenciaPanel acciones={acciones} />
                )
              }
            </Pestanas>
          </GrupoCdaContext.Provider>
        )}
      </Pestanas>
    </div>
  );
}
