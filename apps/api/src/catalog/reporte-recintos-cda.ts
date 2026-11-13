import { BadRequestException } from '@nestjs/common';

import type { ReporteCda, TablaReporte } from '../operadores-cda/reporte-cda';

/** Datos mínimos de un recinto para el reporte "CDA con sus recintos NO CDA". */
export interface RecintoReporte {
  id: string;
  codigoRecinto: string;
  nombre: string;
  cantonNombre: string;
  parroquia: string | null;
  direccion: string | null;
  juntasFemeninas: number | null;
  juntasMasculinas: number | null;
  cdaDestinoId: string | null;
}

const COLUMNAS = [
  { titulo: 'CDA', ancho: 34 },
  { titulo: 'Cantón', ancho: 14 },
  { titulo: 'Parroquia', ancho: 18 },
  { titulo: 'Código', ancho: 10 },
  { titulo: 'Recinto', ancho: 38 },
  { titulo: 'Dirección', ancho: 30 },
  { titulo: 'JF', ancho: 6 },
  { titulo: 'JM', ancho: 6 },
  { titulo: 'JT', ancho: 6 },
];

const juntas = (r: RecintoReporte) => (r.juntasFemeninas ?? 0) + (r.juntasMasculinas ?? 0);
const porNombre = (a: RecintoReporte, b: RecintoReporte) => a.nombre.localeCompare(b.nombre, 'es');

function fila(cda: string, r: RecintoReporte, nombre: string) {
  return [cda, r.cantonNombre, r.parroquia ?? '', r.codigoRecinto, nombre, r.direccion ?? '', r.juntasFemeninas ?? 0, r.juntasMasculinas ?? 0, juntas(r)];
}

/**
 * Cada CDA con los NO CDA que se le asignan (`cdaDestinoId`, no el cantón) y,
 * aparte, los NO CDA sin CDA asignado. Cada CDA cierra con su total de juntas.
 */
export function reporteRecintosCda(
  cdas: RecintoReporte[],
  noCdas: RecintoReporte[],
  dia: string,
  cantonNombre?: string,
): ReporteCda {
  const idsCda = new Set(cdas.map((c) => c.id));
  const porCda = new Map<string, RecintoReporte[]>();
  const sueltos: RecintoReporte[] = [];
  for (const n of noCdas) {
    if (!n.cdaDestinoId || !idsCda.has(n.cdaDestinoId)) {
      sueltos.push(n);
      continue;
    }
    porCda.set(n.cdaDestinoId, [...(porCda.get(n.cdaDestinoId) ?? []), n]);
  }

  const filas: (string | number)[][] = [];
  const resaltadas: number[] = [];
  for (const cda of [...cdas].sort(porNombre)) {
    const etiqueta = `${cda.codigoRecinto} · ${cda.nombre}`;
    const hijos = (porCda.get(cda.id) ?? []).sort(porNombre);
    filas.push(fila(etiqueta, cda, `${cda.nombre} (CDA)`));
    for (const n of hijos) filas.push(fila(etiqueta, n, n.nombre));
    if (hijos.length === 0) filas.push([etiqueta, '', '', '', 'Sin recintos NO CDA asignados', '', '', '', '']);
    resaltadas.push(filas.length);
    filas.push([etiqueta, '', '', '', 'Total de juntas', '', '', '', juntas(cda) + hijos.reduce((s, n) => s + juntas(n), 0)]);
  }

  const tablas: TablaReporte[] = [
    { hoja: 'CDA y NO CDA', titulo: 'CDA con sus recintos NO CDA', columnas: COLUMNAS, filas, resaltadas },
  ];
  if (sueltos.length > 0) {
    tablas.push({
      hoja: 'NO CDA sin CDA',
      titulo: 'Recintos NO CDA sin CDA asignado',
      columnas: COLUMNAS.slice(1),
      filas: sueltos.sort(porNombre).map((n) => fila('', n, n.nombre).slice(1)),
    });
  }

  return {
    titulo: 'Recintos CDA y NO CDA',
    detalle: `${cantonNombre ? `Cantón ${cantonNombre}` : 'Toda la provincia'} · ${cdas.length} CDA · ${noCdas.length} recintos NO CDA`,
    archivo: 'recintos_cda_no_cda',
    desde: dia,
    hasta: dia,
    modo: 'GENERAL',
    limitarDiasPdf: false,
    tablas,
  };
}

const MAX_INT4 = 2_147_483_647;

/** ?cantonId= opcional: entero positivo que cabe en la columna (si no, 400 y no un 500 de la base). */
export function parseCantonReporte(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_INT4) throw new BadRequestException('cantonId inválido');
  return n;
}
