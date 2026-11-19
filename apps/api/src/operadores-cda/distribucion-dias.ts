import type { PersonaDistribucionDias, TotalesDistribucionDia } from '@cne/shared-types';
import { celularInternacional, prefijoDia } from '@cne/shared-validation';

import { type ColumnaReporte, type ReporteCda, type TablaReporte, diaCorto, diaLargo } from './reporte-cda';

/**
 * Distribución del personal por días: cada persona va un solo día y cada día
 * recibe la misma cantidad de hombres y de mujeres (diferencia máxima de una
 * persona). Sin DOM ni base: se prueba suelta.
 */

export type SexoDistribucion = 'M' | 'F' | null;

/**
 * Reparte `personas` entre `fechas` (en orden). Hombres, luego mujeres y al
 * final quienes no tienen el dato, cada grupo en ronda; la ronda sigue donde
 * terminó el grupo anterior, así el total de cada día también queda parejo.
 */
export function repartirEnDias<T extends { sexo: SexoDistribucion }>(personas: T[], fechas: string[]): { persona: T; fecha: string }[] {
  if (fechas.length === 0) throw new Error('Sin días para repartir');
  const grupos: SexoDistribucion[] = ['M', 'F', null];
  const salida: { persona: T; fecha: string }[] = [];
  let cursor = 0;
  for (const sexo of grupos) {
    for (const persona of personas) {
      if (normalizarSexo(persona.sexo) !== sexo) continue;
      salida.push({ persona, fecha: fechas[cursor % fechas.length] });
      cursor++;
    }
  }
  return salida;
}

export function normalizarSexo(s: string | null | undefined): SexoDistribucion {
  return s === 'M' || s === 'F' ? s : null;
}

/** Totales por día en el orden de `fechas` (un día sin nadie sale en cero). */
export function totalesPorDia(personas: { fecha: string; sexo: SexoDistribucion }[], fechas: string[]): TotalesDistribucionDia[] {
  const mapa = new Map(fechas.map((f) => [f, { fecha: f, hombres: 0, mujeres: 0, sinSexo: 0, total: 0 }]));
  for (const p of personas) {
    const t = mapa.get(p.fecha);
    if (!t) continue;
    if (p.sexo === 'M') t.hombres++;
    else if (p.sexo === 'F') t.mujeres++;
    else t.sinSexo++;
    t.total++;
  }
  return [...mapa.values()];
}

const comparar = (a: string | null, b: string | null) => (a ?? '￿').localeCompare(b ?? '￿', 'es', { sensitivity: 'base' });

/** Orden de la tabla y del reporte: día, encargado, cantón y nombre. */
export function ordenarPersonas<T extends Pick<PersonaDistribucionDias, 'fecha' | 'encargado' | 'canton' | 'nombres'>>(personas: T[]): T[] {
  return [...personas].sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || comparar(a.encargado, b.encargado) || comparar(a.canton, b.canton) || comparar(a.nombres, b.nombres),
  );
}

/** Mismo texto de encargado aunque cambien mayúsculas o espacios. */
export function claveEncargado(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('es');
}

const SEXO: Record<'M' | 'F', string> = { M: 'Hombre', F: 'Mujer' };

const COLUMNAS: ColumnaReporte[] = [
  { titulo: 'N.º', ancho: 5 },
  { titulo: 'Apellidos y nombres', ancho: 34 },
  { titulo: 'Cédula', ancho: 12 },
  { titulo: 'Celular', ancho: 13 },
  { titulo: 'Sexo', ancho: 8 },
  { titulo: 'Cargo', ancho: 22 },
  { titulo: 'Cantón', ancho: 14 },
  { titulo: 'Encargado', ancho: 26 },
];

export interface FiltroReporteDistribucion {
  fecha?: string;
  encargado?: string;
}

/** Excel/PDF: una hoja (sección) por día y, si hay varios días, un resumen al inicio. */
export function reporteDistribucion(
  d: { nombre: string; fechas: string[]; personas: PersonaDistribucionDias[] },
  filtro: FiltroReporteDistribucion,
): ReporteCda {
  const fechas = filtro.fecha ? [filtro.fecha] : d.fechas;
  const encargado = filtro.encargado ? claveEncargado(filtro.encargado) : null;
  const personas = ordenarPersonas(
    d.personas.filter((p) => fechas.includes(p.fecha) && (encargado === null || claveEncargado(p.encargado) === encargado)),
  );
  const totales = totalesPorDia(personas, fechas);
  const tablas: TablaReporte[] = [];
  if (fechas.length > 1) tablas.push(resumen(totales));
  for (const t of totales) {
    const filas = personas.filter((p) => p.fecha === t.fecha);
    tablas.push({
      hoja: diaCorto(t.fecha).replace(/\//g, '-'),
      titulo: `${capitalizar(diaLargo(t.fecha))} — ${t.hombres} hombres, ${t.mujeres} mujeres${t.sinSexo ? `, ${t.sinSexo} sin dato` : ''} (total ${t.total})`,
      columnas: COLUMNAS,
      filas: filas.length
        ? filas.map((p, i) => [i + 1, p.nombres, p.cedula, p.telefono ?? '', p.sexo ? SEXO[p.sexo] : '', p.cargo, p.canton ?? '', p.encargado ?? ''])
        : [['', 'Nadie asignado este día', '', '', '', '', '', '']],
    });
  }
  const rango = fechas.length > 1 ? `${diaCorto(fechas[0])} al ${diaCorto(fechas[fechas.length - 1])}` : diaCorto(fechas[0]);
  return {
    titulo: `Distribución del personal por días: ${d.nombre}`,
    detalle: `${rango}${filtro.encargado ? ` · Encargado: ${filtro.encargado}` : ''} · Cada persona va un solo día`,
    archivo: 'distribucion_personal',
    desde: fechas[0],
    hasta: fechas[fechas.length - 1],
    modo: 'GENERAL',
    limitarDiasPdf: false,
    tablas,
  };
}

function resumen(totales: TotalesDistribucionDia[]): TablaReporte {
  const suma = totales.reduce(
    (a, t) => ({ hombres: a.hombres + t.hombres, mujeres: a.mujeres + t.mujeres, sinSexo: a.sinSexo + t.sinSexo, total: a.total + t.total }),
    { hombres: 0, mujeres: 0, sinSexo: 0, total: 0 },
  );
  return {
    hoja: 'Resumen',
    titulo: 'Resumen por día',
    columnas: [
      { titulo: 'Día', ancho: 34 },
      { titulo: 'Hombres', ancho: 10 },
      { titulo: 'Mujeres', ancho: 10 },
      { titulo: 'Sin dato', ancho: 10 },
      { titulo: 'Total', ancho: 10 },
    ],
    filas: [
      ...totales.map((t) => [capitalizar(diaLargo(t.fecha)), t.hombres, t.mujeres, t.sinSexo, t.total]),
      ['Total', suma.hombres, suma.mujeres, suma.sinSexo, suma.total],
    ],
  };
}

function capitalizar(s: string): string {
  return s.charAt(0).toLocaleUpperCase('es') + s.slice(1);
}

/** Escapa un valor de texto de vCard 3.0 (RFC 2426 §4). */
function escaparVcard(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

export interface ContactosVcard {
  contenido: string;
  incluidos: number;
  /** Nombres sin celular válido o con el número repetido de otra persona del día. */
  omitidos: { nombres: string; motivo: 'SIN_CELULAR' | 'REPETIDO' }[];
}

/**
 * Contactos de un día en vCard 3.0 para importarlos de golpe en el teléfono y
 * armar el grupo de WhatsApp. Cada contacto se llama "VIE20 APELLIDOS NOMBRES"
 * para encontrarlos todos escribiendo el prefijo.
 */
export function contactosVcard(personas: Pick<PersonaDistribucionDias, 'fecha' | 'nombres' | 'telefono' | 'encargado' | 'canton'>[], fecha: string): ContactosVcard {
  const prefijo = prefijoDia(fecha);
  const vistos = new Set<string>();
  const tarjetas: string[] = [];
  const omitidos: ContactosVcard['omitidos'] = [];
  for (const p of ordenarPersonas(personas.filter((x) => x.fecha === fecha))) {
    const tel = celularInternacional(p.telefono);
    if (!tel) {
      omitidos.push({ nombres: p.nombres, motivo: 'SIN_CELULAR' });
      continue;
    }
    if (vistos.has(tel)) {
      omitidos.push({ nombres: p.nombres, motivo: 'REPETIDO' });
      continue;
    }
    vistos.add(tel);
    const nombre = escaparVcard(`${prefijo} ${p.nombres}`.replace(/\s+/g, ' ').trim());
    tarjetas.push(['BEGIN:VCARD', 'VERSION:3.0', `N:;${nombre};;;`, `FN:${nombre}`, `TEL;TYPE=CELL:${tel}`, 'END:VCARD'].join('\r\n'));
  }
  return { contenido: tarjetas.length ? `${tarjetas.join('\r\n')}\r\n` : '', incluidos: tarjetas.length, omitidos };
}
