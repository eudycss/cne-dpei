import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { GrupoCda } from '@cne/shared-types';
import { Pestanas } from '../../components/Pestanas';
import { ListadoOperadores } from './ListadoOperadores';
import { AsistenciaPanel } from './AsistenciaPanel';
import { ActasPanel } from './ActasPanel';
import { AtrasosPanel } from './AtrasosPanel';
import { FILTROS_INGRESO } from './filtroIngreso';
import { GRUPOS, GrupoCdaContext, TEXTOS_GRUPO, grupoDeRuta } from './grupo';

const SECCIONES = [
  { id: 'listado', etiqueta: 'Listado' },
  { id: 'asistencia', etiqueta: 'Asistencia' },
  { id: 'atrasos', etiqueta: 'Atrasos' },
  { id: 'actas', etiqueta: 'Actas de entrega' },
] as const;

/**
 * Personal de los Centros de Digitalización de Actas, con el tema "CNE
 * Futurista" de Figma. Dos niveles: el cargo (selector, en ?grupo=; son 8 y
 * en pestañas no cabrían con zoom ni en pantallas angostas) y la sección
 * (pestañas, en ?tab=). Todos los cargos usan los mismos componentes: el
 * grupo les llega por GrupoCdaContext. Se abre en Operadores CDA >
 * Asistencia, que es el uso diario. Cada pestaña pone sus acciones en el
 * encabezado (portal a .ocda-acciones), en el flujo normal.
 */
export function OperadoresCdaPage() {
  const [acciones, setAcciones] = useState<HTMLDivElement | null>(null);
  const [params, setParams] = useSearchParams();
  const grupo = grupoDeRuta(params.get('grupo'));

  function elegirGrupo(g: GrupoCda) {
    // Conserva la sección; los filtros del listado eran del cargo anterior.
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (g === 'OPERADOR') p.delete('grupo');
        else p.set('grupo', TEXTOS_GRUPO[g].ruta);
        for (const f of FILTROS_INGRESO) p.delete(f);
        return p;
      },
      { replace: true },
    );
  }

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
      <label className="ocda-cargo">
        <span>Cargo</span>
        <select value={grupo} onChange={(e) => elegirGrupo(e.target.value as GrupoCda)}>
          {GRUPOS.map((g) => (
            <option key={g} value={g}>
              {TEXTOS_GRUPO[g].titulo}
            </option>
          ))}
        </select>
      </label>
      {/* key: al cambiar de cargo se montan de nuevo (sin fechas ni búsquedas del otro cargo). */}
      <GrupoCdaContext.Provider key={grupo} value={grupo}>
        <Pestanas pestanas={SECCIONES} porDefecto="asistencia" etiqueta={`Secciones de ${TEXTOS_GRUPO[grupo].titulo}`}>
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
    </div>
  );
}
