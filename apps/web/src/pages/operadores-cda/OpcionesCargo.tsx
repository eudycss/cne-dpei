import { CENTROS, GRUPOS, TEXTOS_GRUPO } from './grupo';

/** Nombre completo de cada centro: el lector de pantalla anuncia el grupo con él. */
const NOMBRE_CENTRO: Record<(typeof CENTROS)[number], string> = {
  CDA: 'CDA — Centros de Digitalización de Actas',
  CPE: 'CPE — Centro de Procesamiento Electoral',
};

/** Opciones de un <select> de cargo, agrupadas en CDA y CPE. */
export function OpcionesCargo() {
  return (
    <>
      {CENTROS.map((centro) => (
        <optgroup key={centro} label={NOMBRE_CENTRO[centro]}>
          {GRUPOS.filter((g) => TEXTOS_GRUPO[g].centro === centro).map((g) => (
            <option key={g} value={g}>
              {TEXTOS_GRUPO[g].titulo}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
