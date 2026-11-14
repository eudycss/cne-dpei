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

export interface FilaOrden {
  orden: number;
  codigoRecinto: string;
  nombreRecinto: string;
  /** Solo en NO CDA: el CDA desde el que se visita. */
  cda?: string;
  cantonNombre: string;
  tecnicoNombre: string;
  operadorNombre?: string | null;
  asistenteNombre?: string | null;
  hora: string;
}

export interface OrdenLlegada {
  filas: FilaOrden[];
  pendientes: number;
}

export interface FiltroOrden {
  canton: string;
  tecnico: string;
}

/** `''` = todos. Un técnico vacío se muestra y filtra como "Sin técnico". */
const coincide = (x: ConGrupo, f: FiltroOrden) =>
  (!f.canton || grupoDe('canton')(x) === f.canton) && (!f.tecnico || grupoDe('tecnico')(x) === f.tecnico);

/** Minuto de una hora ISO; null si no es una fecha válida. */
const minutoDe = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 60000);
};

/**
 * Numera por hora, de la más temprana a la más tardía. Las horas que se ven
 * iguales (mismo minuto) llevan el mismo N.º; dentro de ellas, orden por código.
 * Las filas sin hora válida cuentan como pendientes.
 */
function numerar<T extends { codigoRecinto: string }>(
  items: T[],
  horaDe: (t: T) => string | null,
  aFila: (t: T, orden: number, hora: string) => FilaOrden,
): OrdenLlegada {
  const con = items.flatMap((t) => {
    const hora = horaDe(t);
    const minuto = hora === null ? null : minutoDe(hora);
    return hora !== null && minuto !== null ? [{ t, hora, minuto }] : [];
  });
  con.sort((x, y) => x.minuto - y.minuto || Date.parse(x.hora) - Date.parse(y.hora) || x.t.codigoRecinto.localeCompare(y.t.codigoRecinto, 'es'));
  let orden = 0;
  let anterior: number | null = null;
  const filas = con.map((x, i) => {
    if (x.minuto !== anterior) orden = i + 1;
    anterior = x.minuto;
    return aFila(x.t, orden, x.hora);
  });
  return { filas, pendientes: items.length - con.length };
}

/** Orden en que las parejas completaron una etapa. Las que faltan solo se cuentan. */
export function ordenPorEtapa(datos: EstadisticasJornadaDto, etapa: EtapaClave, filtro: FiltroOrden): OrdenLlegada {
  return numerar(
    datos.unidades.filter((u) => coincide(u, filtro)),
    (u) => u[etapa],
    (u, orden, hora) => ({
      orden,
      codigoRecinto: u.codigoRecinto,
      nombreRecinto: u.nombreRecinto,
      cantonNombre: u.cantonNombre,
      tecnicoNombre: u.tecnicoNombre || 'Sin técnico',
      operadorNombre: u.operadorNombre,
      asistenteNombre: u.asistenteNombre,
      hora,
    }),
  );
}

/** Orden en que se llegó a cada NO CDA. */
export function ordenNoCda(datos: EstadisticasJornadaDto, filtro: FiltroOrden): OrdenLlegada {
  return numerar(
    datos.noCdas.filter((n) => coincide(n, filtro)),
    (n) => n.llegadaEn,
    (n, orden, hora) => ({
      orden,
      codigoRecinto: n.codigoRecinto,
      nombreRecinto: n.nombreRecinto,
      cda: `${n.codigoCda} · ${n.nombreCda}`,
      cantonNombre: n.cantonNombre,
      tecnicoNombre: n.tecnicoNombre || 'Sin técnico',
      hora,
    }),
  );
}

/** Opciones únicas y ordenadas para los filtros de cantón y técnico. */
export function opcionesFiltro(datos: EstadisticasJornadaDto, agrupacion: Agrupacion): string[] {
  const nombres = new Set([...datos.unidades, ...datos.noCdas].map(grupoDe(agrupacion)));
  return Array.from(nombres).sort((a, b) => a.localeCompare(b, 'es'));
}
