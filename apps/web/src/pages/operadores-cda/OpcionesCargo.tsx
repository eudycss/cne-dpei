import type { GrupoCda } from '@cne/shared-types';
import { CENTROS, useCargosCda } from './grupo';

/** Nombre completo de cada centro: el lector de pantalla anuncia el grupo con él. */
const NOMBRE_CENTRO: Record<(typeof CENTROS)[number], string> = {
  CDA: 'CDA — Centros de Digitalización de Actas',
  CPE: 'CPE — Centro de Procesamiento Electoral',
};

/**
 * Opciones de un <select> de cargo, agrupadas en CDA y CPE. Los cargos
 * desactivados no salen, salvo `actual` (el que ya está elegido).
 */
export function OpcionesCargo({ actual }: { actual?: GrupoCda }) {
  const { cargos } = useCargosCda();
  const visibles = cargos.filter((c) => c.activo || c.clave === actual);
  return (
    <>
      {CENTROS.map((centro) => (
        <optgroup key={centro} label={NOMBRE_CENTRO[centro]}>
          {visibles
            .filter((c) => c.centro === centro)
            .map((c) => (
              <option key={c.clave} value={c.clave}>
                {c.activo ? c.nombre : `${c.nombre} (desactivado)`}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}
