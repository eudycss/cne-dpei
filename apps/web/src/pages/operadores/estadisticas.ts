import type { EstadisticasJornadaDto, NoCdaEstadisticaJornada, UnidadEstadisticaJornada } from '@cne/shared-types';

export type EtapaClave = 'salidaDpiEn' | 'llegadaRecintoEn' | 'salidaRecintoEn' | 'llegadaDpiEn';

/** Las etapas del recorrido, en orden: de la salida del DPEI al regreso. */
export const ETAPAS: { clave: EtapaClave; etiqueta: string; hecho: string }[] = [
  { clave: 'salidaDpiEn', etiqueta: 'Salida del DPEI', hecho: 'Ya salieron del DPEI' },
  { clave: 'llegadaRecintoEn', etiqueta: 'Llegada al recinto', hecho: 'Ya llegaron al recinto' },
  { clave: 'salidaRecintoEn', etiqueta: 'Salida del recinto', hecho: 'Ya salieron del recinto' },
  { clave: 'llegadaDpiEn', etiqueta: 'Llegada al DPEI', hecho: 'Ya regresaron al DPEI' },
];

export interface GrupoAvance {
  nombre: string;
  hechos: number;
  total: number;
}

export const porcentaje = (hechos: number, total: number) => (total > 0 ? Math.round((hechos / total) * 100) : 0);

/**
 * Del mayor al menor porcentaje (el que más avanzó, primero). Se compara la
 * fracción exacta; a igual porcentaje, el grupo con más personas y por nombre.
 */
export function ordenarPorAvance(grupos: GrupoAvance[]): GrupoAvance[] {
  return [...grupos].sort(
    (a, b) => b.hechos * a.total - a.hechos * b.total || b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'),
  );
}

/** Cuenta, por grupo, cuántos elementos cumplen `hecho`; ya ordenado por avance. */
export function agrupar<T>(items: T[], nombreDe: (t: T) => string, hecho: (t: T) => boolean): GrupoAvance[] {
  const porNombre = new Map<string, GrupoAvance>();
  for (const item of items) {
    const nombre = nombreDe(item) || 'Sin asignar';
    const grupo = porNombre.get(nombre) ?? { nombre, hechos: 0, total: 0 };
    grupo.total += 1;
    if (hecho(item)) grupo.hechos += 1;
    porNombre.set(nombre, grupo);
  }
  return ordenarPorAvance(Array.from(porNombre.values()));
}

export type Agrupacion = 'canton' | 'tecnico';

type ConGrupo = Pick<UnidadEstadisticaJornada | NoCdaEstadisticaJornada, 'cantonNombre' | 'tecnicoNombre'>;

export const grupoDe = (agrupacion: Agrupacion) => (x: ConGrupo) =>
  (agrupacion === 'canton' ? x.cantonNombre : x.tecnicoNombre) || (agrupacion === 'canton' ? 'Sin cantón' : 'Sin técnico');

export function avancePorEtapa(datos: EstadisticasJornadaDto, etapa: EtapaClave, agrupacion: Agrupacion): GrupoAvance[] {
  return agrupar(datos.unidades, grupoDe(agrupacion), (u) => u[etapa] !== null);
}

export function avanceNoCda(datos: EstadisticasJornadaDto, agrupacion: Agrupacion): GrupoAvance[] {
  return agrupar(datos.noCdas, grupoDe(agrupacion), (n) => n.llegadaEn !== null);
}

/** Cuántas parejas completaron cada etapa (para las tarjetas). */
export function embudo(datos: EstadisticasJornadaDto): { clave: EtapaClave; hechos: number; total: number }[] {
  return ETAPAS.map((e) => ({
    clave: e.clave,
    hechos: datos.unidades.filter((u) => u[e.clave] !== null).length,
    total: datos.unidades.length,
  }));
}
