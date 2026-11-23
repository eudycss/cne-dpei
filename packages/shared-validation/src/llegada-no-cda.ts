/**
 * Resumen del reporte "llegada de los NO CDA a su CDA" (web y bot): cuántos
 * recintos y cuántas juntas ya llegaron, en total, por CDA y por cantón.
 * Tipos estructurales: sirve tal cual con `ReporteNoCdaItem` de shared-types.
 */

/**
 * NO CDA sin CDA de destino: llevan sus actas directo a la Delegación. En el
 * reporte y en el bot van como un grupo más, con este id y este código.
 */
export const CDA_ID_DELEGACION = 'DELEGACION';
export const CODIGO_DELEGACION = 'DPEI';
export const NOMBRE_DELEGACION = 'Delegación Imbabura (directo, sin CDA)';

export interface NoCdaParaResumen {
  cantonNombre: string;
  juntas: number;
  llegado: boolean;
}

export interface CdaParaResumen {
  noCdas: ReadonlyArray<NoCdaParaResumen>;
}

export interface Avance {
  hechos: number;
  total: number;
}

export interface AvanceCanton {
  canton: string;
  recintos: Avance;
  juntas: Avance;
}

export interface ResumenLlegadaNoCda {
  recintos: Avance;
  juntas: Avance;
  /** CDA con al menos un NO CDA (los que no tienen no cuentan). */
  cdas: { completos: number; sinLlegadas: number; total: number };
  /** Por cantón del NO CDA, ordenado por nombre. */
  porCanton: AvanceCanton[];
}

const vacio = (): Avance => ({ hechos: 0, total: 0 });

function sumar(avance: Avance, hecho: boolean, cantidad = 1): void {
  avance.total += cantidad;
  if (hecho) avance.hechos += cantidad;
}

export function resumenLlegadaNoCda(cdas: ReadonlyArray<CdaParaResumen>): ResumenLlegadaNoCda {
  const recintos = vacio();
  const juntas = vacio();
  const conteoCdas = { completos: 0, sinLlegadas: 0, total: 0 };
  const cantones = new Map<string, AvanceCanton>();

  for (const cda of cdas) {
    if (cda.noCdas.length === 0) continue;
    conteoCdas.total += 1;
    const llegados = cda.noCdas.filter((n) => n.llegado).length;
    if (llegados === cda.noCdas.length) conteoCdas.completos += 1;
    if (llegados === 0) conteoCdas.sinLlegadas += 1;

    for (const n of cda.noCdas) {
      sumar(recintos, n.llegado);
      sumar(juntas, n.llegado, n.juntas);
      const canton = cantones.get(n.cantonNombre) ?? { canton: n.cantonNombre, recintos: vacio(), juntas: vacio() };
      sumar(canton.recintos, n.llegado);
      sumar(canton.juntas, n.llegado, n.juntas);
      cantones.set(n.cantonNombre, canton);
    }
  }

  return {
    recintos,
    juntas,
    cdas: conteoCdas,
    porCanton: [...cantones.values()].sort((a, b) => a.canton.localeCompare(b.canton, 'es')),
  };
}

/** Porcentaje entero (0 si no hay total): 312 de 483 → 65. */
export function porcentajeAvance({ hechos, total }: Avance): number {
  return total === 0 ? 0 : Math.round((hechos / total) * 100);
}
