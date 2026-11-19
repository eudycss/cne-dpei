import type { PersonaDistribucionDias, TotalesDistribucionDia } from '@cne/shared-types';
import { coincideBusqueda } from '@cne/shared-validation';

/** Cargos que la distribución deja fuera de fábrica (se pueden agregar a mano). */
export const EXCLUIDOS_POR_DEFECTO = ['SUPERVISOR', 'ASISTENTE_ARCHIVOS'] as const;

/** Mismo texto aunque cambien mayúsculas, tildes o espacios (como en la API). */
export function claveTexto(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('es');
}

/** Valores distintos de una columna (para filtros y sugerencias), en orden alfabético. */
export function valoresUnicos(valores: ReadonlyArray<string | null>): string[] {
  const vistos = new Map<string, string>();
  for (const v of valores) {
    const t = v?.trim();
    if (t && !vistos.has(claveTexto(t))) vistos.set(claveTexto(t), t);
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

export interface FiltroTabla {
  fecha: string;
  encargado: string;
  buscar: string;
}

/** Filas de la tabla: día y encargado exactos (vacío = todos) y búsqueda sin tildes. */
export function filtrarPersonas(personas: PersonaDistribucionDias[], f: FiltroTabla): PersonaDistribucionDias[] {
  const encargado = f.encargado ? claveTexto(f.encargado) : null;
  return personas.filter(
    (p) =>
      (!f.fecha || p.fecha === f.fecha) &&
      (encargado === null || claveTexto(p.encargado) === encargado) &&
      coincideBusqueda([p.nombres, p.cedula, p.cargo, p.canton, p.encargado], f.buscar),
  );
}

/**
 * Tras editar a mano: si entre los días hay más de una persona de diferencia en
 * hombres o en mujeres, la distribución dejó de ser equitativa.
 */
export function desbalance(totales: TotalesDistribucionDia[]): { hombres: boolean; mujeres: boolean } {
  const dif = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
  return { hombres: dif(totales.map((t) => t.hombres)) > 1, mujeres: dif(totales.map((t) => t.mujeres)) > 1 };
}

/** Viernes, sábado y domingo siguientes a `hoy` (AAAA-MM-DD); si hoy es viernes, desde hoy. */
export function proximoFinDeSemana(hoy: string): string[] {
  const d = new Date(`${hoy}T12:00:00Z`);
  const hastaViernes = (5 - d.getUTCDay() + 7) % 7;
  return [0, 1, 2].map((i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + hastaViernes + i);
    return x.toISOString().slice(0, 10);
  });
}

/** "2026-11-20" → "vie 20/11" (encabezados cortos y opciones). */
export function diaCorto(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const semana = d.toLocaleDateString('es-EC', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
  return `${semana} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

export const SEXO_TEXTO: Record<'M' | 'F', string> = { M: 'Hombre', F: 'Mujer' };
