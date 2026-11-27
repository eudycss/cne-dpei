import type { CentroCda, ModoReportePersonalCda } from '@cne/shared-types';

import type { Celda, ColumnaReporte, ReporteCda, TablaReporte } from './reporte-cda';

/**
 * Reporte del personal CDA/CPE activo de los cargos elegidos: un resumen con
 * cuántas personas hay por cargo y luego el listado, en una sola tabla o una
 * hoja (Excel) / sección (PDF) por cargo. Funciones puras: el servicio pone
 * los cargos y las personas.
 */

export interface CargoReporte {
  clave: string;
  nombre: string;
  centro: CentroCda;
  orden: number;
}

export interface PersonaReporte {
  apellidosNombres: string;
  cedula: string;
  grupo: string;
}

const COLUMNAS: ColumnaReporte[] = [
  { titulo: 'N°', ancho: 6 },
  { titulo: 'Apellidos y nombres', ancho: 42 },
  { titulo: 'Cédula', ancho: 14 },
  { titulo: 'Cargo', ancho: 30 },
  { titulo: 'Centro', ancho: 9 },
];

const COLUMNAS_RESUMEN: ColumnaReporte[] = [
  { titulo: 'Cargo', ancho: 36 },
  { titulo: 'Centro', ancho: 10 },
  { titulo: 'Personas', ancho: 12 },
];

const SIN_PERSONAL = 'No hay personal activo en los cargos elegidos.';

/** Orden del combo de cargos (`orden`) y, si empatan, por clave. */
export function ordenarCargos(cargos: CargoReporte[]): CargoReporte[] {
  return [...cargos].sort((a, b) => a.orden - b.orden || a.clave.localeCompare(b.clave));
}

/** Por el orden de su cargo y luego alfabético por apellidos. */
function ordenarPersonas(personas: PersonaReporte[], cargos: CargoReporte[]): PersonaReporte[] {
  const pos = new Map(cargos.map((c, i) => [c.clave, i]));
  return [...personas].sort(
    (a, b) =>
      (pos.get(a.grupo) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.grupo) ?? Number.MAX_SAFE_INTEGER) ||
      a.apellidosNombres.localeCompare(b.apellidosNombres, 'es'),
  );
}

function filas(personas: PersonaReporte[], cargos: Map<string, CargoReporte>): Celda[][] {
  return personas.map((p, i) => {
    const c = cargos.get(p.grupo);
    return [i + 1, p.apellidosNombres, p.cedula, c?.nombre ?? p.grupo, c?.centro ?? ''];
  });
}

/** Etiqueta del alcance: "CDA", "CPE" o "CDA y CPE". */
function centrosDe(cargos: CargoReporte[]): string {
  const centros = new Set(cargos.map((c) => c.centro));
  return centros.size === 2 ? 'CDA y CPE' : [...centros][0] ?? '';
}

/** Hoja de Excel: 31 caracteres como máximo, sin repetir y sin los caracteres que Excel prohíbe. */
function nombreHoja(nombre: string, usadas: Set<string>): string {
  const limpio = nombre
    .replace(/[\\/?*[\]:]/g, ' ')
    .slice(0, 31)
    .trim()
    .replace(/^'+|'+$/g, '')
    .trim();
  // "Historial" (History) es un nombre reservado de Excel.
  const base = limpio && limpio.toLowerCase() !== 'historial' ? limpio : 'Cargo';
  let hoja = base;
  for (let n = 2; usadas.has(hoja.toLowerCase()); n++) hoja = `${base.slice(0, 31 - `${n}`.length - 1).trim()} ${n}`;
  usadas.add(hoja.toLowerCase());
  return hoja;
}

export function reportePersonal(
  cargosElegidos: CargoReporte[],
  personas: PersonaReporte[],
  modo: ModoReportePersonalCda,
  hoy: string,
): ReporteCda {
  const cargos = ordenarCargos(cargosElegidos);
  const porClave = new Map(cargos.map((c) => [c.clave, c]));
  const ordenadas = ordenarPersonas(
    personas.filter((p) => porClave.has(p.grupo)),
    cargos,
  );
  const conteo = new Map<string, number>();
  for (const p of ordenadas) conteo.set(p.grupo, (conteo.get(p.grupo) ?? 0) + 1);

  const resumen: TablaReporte = {
    hoja: 'Resumen',
    titulo: 'Resumen por cargo',
    columnas: COLUMNAS_RESUMEN,
    filas: [...cargos.map((c) => [c.nombre, c.centro, conteo.get(c.clave) ?? 0]), ['TOTAL', '', ordenadas.length]],
  };

  const vacia = (titulo: string, hoja: string): TablaReporte => ({
    hoja,
    titulo,
    columnas: [{ titulo: 'Mensaje', ancho: 60 }],
    filas: [[SIN_PERSONAL]],
  });

  const usadas = new Set(['resumen']);
  const tablas: TablaReporte[] =
    modo === 'POR_CARGO'
      ? cargos.map((c) => {
          const delCargo = ordenadas.filter((p) => p.grupo === c.clave);
          const hoja = nombreHoja(c.nombre, usadas);
          const titulo = `${c.nombre} (${c.centro}) — ${delCargo.length} ${delCargo.length === 1 ? 'persona' : 'personas'}`;
          return delCargo.length ? { hoja, titulo, columnas: COLUMNAS, filas: filas(delCargo, porClave) } : vacia(titulo, hoja);
        })
      : [
          ordenadas.length
            ? { hoja: 'Personal', titulo: `Listado general — ${ordenadas.length} ${ordenadas.length === 1 ? 'persona' : 'personas'}`, columnas: COLUMNAS, filas: filas(ordenadas, porClave) }
            : vacia('Listado general', 'Personal'),
        ];

  const centros = centrosDe(cargos);
  return {
    titulo: `Personal ${centros}`,
    detalle: `Solo personal activo · ${cargos.length} ${cargos.length === 1 ? 'cargo' : 'cargos'} · ${modo === 'POR_CARGO' ? 'Por cargo' : 'General'}`,
    archivo: `personal_${centros.toLowerCase().replace(/ y /g, '_')}${modo === 'POR_CARGO' ? '_por_cargo' : ''}`,
    desde: hoy,
    hasta: hoy,
    modo: 'GENERAL',
    limitarDiasPdf: false,
    unaFecha: true,
    tablas: [resumen, ...tablas],
  };
}
