import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { GrupoCda } from '@cne/shared-types';
import { Pestanas } from '../../components/Pestanas';
import { ListadoOperadores } from './ListadoOperadores';
import { AsistenciaPanel } from './AsistenciaPanel';
import { ActasPanel } from './ActasPanel';
import { ParejasPanel } from './ParejasPanel';
import { AtrasosPanel } from './AtrasosPanel';
import { FILTROS_INGRESO } from './filtroIngreso';
import { CARGOS_BASE, CargosCdaContext, GrupoCdaContext, grupoDeRuta, textosDeCargo } from './grupo';
import { OpcionesCargo } from './OpcionesCargo';
import { BuscadorGeneral } from './BuscadorGeneral';
import { GestionarCargosModal } from './GestionarCargosModal';
import { getCargosCda } from '../../lib/queries/operadores-cda';
import { useAuth } from '../../auth/AuthContext';

const SECCIONES = [
  { id: 'listado', etiqueta: 'Listado' },
  { id: 'asistencia', etiqueta: 'Asistencia' },
  { id: 'atrasos', etiqueta: 'Atrasos' },
  { id: 'actas', etiqueta: 'Actas de entrega' },
  { id: 'parejas', etiqueta: 'Parejas' },
] as const;

/** Las parejas (operador + asistente por recinto) solo son de los dos cargos CDA. */
const seccionesDe = (grupo: GrupoCda) =>
  grupo === 'OPERADOR' || grupo === 'ASISTENTE' ? SECCIONES : SECCIONES.filter((s) => s.id !== 'parejas');

/**
 * Personal CDA y CPE, con el tema "CNE Futurista" de Figma. Dos niveles: el
 * cargo (selector agrupado por centro, en ?grupo=; son 9 y en pestañas no
 * cabrían con zoom ni en pantallas angostas) y la sección
 * (pestañas, en ?tab=). Todos los cargos usan los mismos componentes: el
 * grupo les llega por GrupoCdaContext. Se abre en Operadores CDA >
 * Asistencia, que es el uso diario. Cada pestaña pone sus acciones en el
 * encabezado (portal a .ocda-acciones), en el flujo normal.
 */
export function OperadoresCdaPage() {
  const [acciones, setAcciones] = useState<HTMLDivElement | null>(null);
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const [gestionando, setGestionando] = useState(false);
  // Mientras llega la lista (o si viniera vacía) quedan los 9 originales.
  const { data } = useQuery({ queryKey: ['cargos-cda'], queryFn: getCargosCda, staleTime: 5 * 60_000 });
  const cargos = data && data.length > 0 ? data : CARGOS_BASE;
  const grupo = grupoDeRuta(params.get('grupo'), cargos);
  const textos = textosDeCargo(grupo, cargos);

  function elegirGrupo(g: GrupoCda) {
    // Conserva la sección; los filtros del listado eran del cargo anterior.
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (g === 'OPERADOR') p.delete('grupo');
        else p.set('grupo', textosDeCargo(g, cargos).ruta);
        for (const f of FILTROS_INGRESO) p.delete(f);
        return p;
      },
      { replace: true },
    );
  }

  return (
    <CargosCdaContext.Provider value={cargos}>
      <div className="tema-futurista ocda">
        <div className="ocda-encabezado">
          <div>
            <p className="ocda-ruta">Personal / CDA y CPE</p>
            <h2 className="ocda-titulo">CDA y CPE</h2>
            <p className="ocda-subtitulo">
              Asistencia, atrasos, fotos y actas de entrega del personal de los Centros de Digitalización de Actas
              (CDA) y del Centro de Procesamiento Electoral (CPE).
            </p>
          </div>
          <div className="ocda-acciones" ref={setAcciones} />
        </div>
        <BuscadorGeneral />
        <div className="ocda-cargo-fila">
          <label className="ocda-cargo">
            <span>Cargo</span>
            <select value={grupo} onChange={(e) => elegirGrupo(e.target.value as GrupoCda)}>
              <OpcionesCargo actual={grupo} />
            </select>
          </label>
          {isAdmin && (
            <button type="button" className="btn secondary ocda-btn-chico" onClick={() => setGestionando(true)}>
              Gestionar cargos
            </button>
          )}
        </div>
        {gestionando && <GestionarCargosModal onClose={() => setGestionando(false)} />}
        {/* key: al cambiar de cargo se montan de nuevo (sin fechas ni búsquedas del otro cargo). */}
        <GrupoCdaContext.Provider key={grupo} value={grupo}>
          <Pestanas pestanas={seccionesDe(grupo)} porDefecto="asistencia" etiqueta={`Secciones de ${textos.titulo}`}>
            {(seccion) =>
              seccion === 'listado' ? (
                <ListadoOperadores acciones={acciones} />
              ) : seccion === 'atrasos' ? (
                <AtrasosPanel acciones={acciones} />
              ) : seccion === 'actas' ? (
                <ActasPanel acciones={acciones} />
              ) : seccion === 'parejas' ? (
                <ParejasPanel />
              ) : (
                <AsistenciaPanel acciones={acciones} />
              )
            }
          </Pestanas>
        </GrupoCdaContext.Provider>
      </div>
    </CargosCdaContext.Provider>
  );
}
