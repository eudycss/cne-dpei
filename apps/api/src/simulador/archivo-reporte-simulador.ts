import type { FilaReporteSimulador, FormatoReporteCda, IntentoReporteSimulador, ReporteSimulador } from '@cne/shared-types';
import { textoTiempoIntento } from '@cne/shared-validation';

import { fecha as fechaHora } from '../common/pdf';
import { diaEcuador } from '../operadores-cda/dia-ecuador';
import {
  generarReporte,
  type ArchivoReporte,
  type Celda,
  type ColumnaReporte,
  type TablaReporte,
} from '../operadores-cda/reporte-cda';
import { intentoMejor, totales } from './reporte-simulador';

/** Excel (hojas General e Intentos) y PDF (mismas secciones) con el encabezado institucional. */

export const ESTADO_PERSONA: Record<FilaReporteSimulador['estado'], string> = {
  NO_SE_PRESENTO: 'No se presentó',
  EN_CURSO: 'En curso',
  TERMINADO: 'Terminó',
};

export function resultadoIntento(i: IntentoReporteSimulador): string {
  if (i.motivo === 'META') return 'Cumplió la meta';
  if (i.motivo === 'TIEMPO') return 'Se acabó el tiempo';
  return 'En curso';
}

// En el PDF horizontal todo va en ~745 pt: anchos pensados para que ningún
// título se parta a mitad de palabra ("Registros" necesita ~13).
const REG = (titulo: string): ColumnaReporte => ({ titulo, ancho: 13 });

/** "Intento 1", "Intento 2"…: el tiempo de cada uno (18:24 o 25:00 · faltaron 3 actas). */
const columnaIntento = (n: number): ColumnaReporte => ({ titulo: `Intento ${n}`, ancho: 16 });

const columnasGeneral = (intentos: number): ColumnaReporte[] => [
  { titulo: 'Nº', ancho: 5 },
  { titulo: 'Cédula', ancho: 15 },
  { titulo: 'Apellidos y nombres', ancho: 28 },
  { titulo: 'Celular', ancho: 15 },
  { titulo: 'Cargo', ancho: 17 },
  { titulo: 'Estado', ancho: 13 },
  { titulo: 'Intentos', ancho: 11 },
  REG('Registros digitados'),
  REG('Registros correctos'),
  REG('Registros con error'),
  { titulo: 'Por minuto', ancho: 11 },
  { titulo: 'Actas', ancho: 9 },
  { titulo: 'Cumplió', ancho: 11 },
  ...Array.from({ length: intentos }, (_, i) => columnaIntento(i + 1)),
];

const COLUMNAS_INTENTOS: ColumnaReporte[] = [
  { titulo: 'Cédula', ancho: 15 },
  { titulo: 'Apellidos y nombres', ancho: 24 },
  { titulo: 'Cargo', ancho: 16 },
  { titulo: 'Intento', ancho: 10 },
  { titulo: 'Inicio', ancho: 14 },
  { titulo: 'Resultado', ancho: 14 },
  // Ancho para "faltaron 10 actas" en una línea (en el PDF va bajo el tiempo).
  { titulo: 'Tiempo', ancho: 19 },
  REG('Registros digitados'),
  REG('Registros correctos'),
  REG('Registros con error'),
  { titulo: 'Por minuto', ancho: 11 },
  { titulo: 'Actas', ancho: 9 },
  { titulo: 'Actas sin error', ancho: 11 },
  { titulo: 'Mejor', ancho: 9 },
];

const registros = (i: IntentoReporteSimulador | null): Celda[] =>
  i ? [i.filasDigitadas, i.filasCorrectas, i.filasConError, i.registrosPorMinuto, i.actasCompletadas] : ['', '', '', '', ''];

/** Cuántas columnas "Intento N" lleva el general: las del que más intentos tiene (al menos 1). */
/** Por el mayor número (no por cuántos): si falta un intento, sus columnas siguen alineadas. */
const maxIntentos = (filas: FilaReporteSimulador[]) => Math.max(1, ...filas.flatMap((f) => f.intentos.map((i) => i.numero)));

/** En el PDF el tiempo va en dos líneas ("25:00" y "faltaron 3 actas"): la fila crece y la columna no se ensancha. */
const tiempo = (i: IntentoReporteSimulador, pdf: boolean) => (pdf ? textoTiempoIntento(i).replace(' · ', '\n') : textoTiempoIntento(i));

/** El tiempo de los intentos `desde`..`hasta` por su número (vacío si no lo hizo). */
const tiemposPorIntento = (f: FilaReporteSimulador, desde: number, hasta: number, pdf = false): Celda[] =>
  Array.from({ length: Math.max(0, hasta - desde + 1) }, (_, n) => {
    const i = f.intentos.find((x) => x.numero === desde + n);
    return i ? tiempo(i, pdf) : '';
  });

/** En el PDF, columnas de intentos por tabla: más no caben en la hoja horizontal sin apretar el texto. */
export const INTENTOS_POR_TABLA_PDF = 6;

/**
 * PDF: el tiempo de cada intento en tablas aparte (de a 6 intentos), para que
 * el general conserve sus anchos con cualquier cantidad de intentos o actas.
 */
function tablasTiemposPdf(filas: FilaReporteSimulador[]): TablaReporte[] {
  const conIntentos = filas.filter((f) => f.intentos.length > 0);
  if (conIntentos.length === 0) return [];
  const total = Math.max(...conIntentos.flatMap((f) => f.intentos.map((i) => i.numero)));
  const bloques = Math.ceil(total / INTENTOS_POR_TABLA_PDF);
  return Array.from({ length: bloques }, (_, b) => {
    const desde = b * INTENTOS_POR_TABLA_PDF + 1;
    const hasta = Math.min(total, desde + INTENTOS_POR_TABLA_PDF - 1);
    return {
      hoja: `Tiempos ${desde}-${hasta}`,
      titulo: bloques === 1 ? 'Tiempo de cada intento' : `Tiempo de cada intento (intentos ${desde} a ${hasta})`,
      columnas: [
        { titulo: 'Nº', ancho: 5 },
        { titulo: 'Cédula', ancho: 15 },
        { titulo: 'Apellidos y nombres', ancho: 30 },
        ...Array.from({ length: hasta - desde + 1 }, (_, n) => columnaIntento(desde + n)),
      ],
      filas: conIntentos.map((f, n) => [n + 1, f.cedula, f.apellidosNombres, ...tiemposPorIntento(f, desde, hasta, true)]),
    };
  });
}

/** `pdf`: sin las columnas "Intento N" (en el PDF van en su propia tabla). */
function tablaGeneral(rep: ReporteSimulador, filas: FilaReporteSimulador[], pdf = false): TablaReporte {
  const t = rep.totales;
  const cuantos = pdf ? 0 : maxIntentos(filas);
  return {
    hoja: 'General',
    titulo: pdf
      ? 'Reporte general (mejor intento de cada persona)'
      : 'Reporte general (mejor intento de cada persona; tiempo de cada intento al final)',
    columnas: columnasGeneral(cuantos),
    filas: filas.map((f, n) => [
      n + 1,
      f.cedula,
      f.apellidosNombres,
      f.telefono ?? '',
      f.cargo,
      f.asignada ? ESTADO_PERSONA[f.estado] : `${ESTADO_PERSONA[f.estado]} (ya no asignada)`,
      f.intentos.length,
      ...registros(intentoMejor(f)),
      f.estado === 'NO_SE_PRESENTO' ? '' : f.cumplio ? 'Sí' : 'No',
      ...tiemposPorIntento(f, 1, cuantos),
    ]),
    // En rojo claro quien no se presentó.
    resaltadas: filas.flatMap((f, i) => (f.estado === 'NO_SE_PRESENTO' ? [i] : [])),
    anexo: {
      titulo: 'Resumen',
      columnas: [
        { titulo: 'Personas', ancho: 12 },
        { titulo: 'Se presentaron', ancho: 12 },
        { titulo: 'Cumplieron la meta', ancho: 12 },
        { titulo: 'En curso', ancho: 12 },
        { titulo: 'No se presentaron', ancho: 12 },
      ],
      filas: [[t.personas, t.presentaron, t.cumplieron, t.enCurso, t.noSePresentaron]],
    },
  };
}

function tablaIntentos(filas: FilaReporteSimulador[], pdf = false): TablaReporte {
  const conIntentos = filas.filter((f) => f.intentos.length > 0);
  return {
    hoja: 'Intentos',
    titulo: 'Detalle por persona: todos los intentos',
    columnas: COLUMNAS_INTENTOS,
    filas: conIntentos.flatMap((f) =>
      f.intentos.map((i) => [
        f.cedula,
        f.apellidosNombres,
        i.cargo,
        i.numero,
        fechaHora(new Date(i.iniciadoEn)),
        resultadoIntento(i),
        tiempo(i, pdf),
        ...registros(i),
        i.actasPerfectas,
        i.numero === f.mejor ? 'Sí' : '',
      ]),
    ),
  };
}

/** Tablas del archivo: el Excel lleva los tiempos en el General; el PDF, en tablas aparte. */
export function tablasReporteSimulador(rep: ReporteSimulador, filas: FilaReporteSimulador[], formato: FormatoReporteCda): TablaReporte[] {
  const pdf = formato === 'pdf';
  const general = tablaGeneral(rep, filas, pdf);
  return pdf ? [general, ...tablasTiemposPdf(filas), tablaIntentos(filas, true)] : [general, tablaIntentos(filas)];
}

/** `persona`: solo esa fila (reporte individual). */
export function archivoReporteSimulador(
  rep: ReporteSimulador,
  formato: FormatoReporteCda,
  persona?: FilaReporteSimulador,
): Promise<ArchivoReporte> {
  const p = rep.practica;
  const filas = persona ? [persona] : rep.filas;
  const detalle =
    `${p.nombre} · Meta: ${p.metaActas} actas de ${p.filasPorActa} filas en ${p.plazoMinutos} min · ` +
    `Se podía empezar del ${fechaHora(new Date(p.inicio))} al ${fechaHora(new Date(p.fin))} · ` +
    'Mejor intento: el que cumplió la meta; si no, el de más registros correctos';
  return generarReporte(
    {
      titulo: persona ? `SIMULADOR DE DIGITACIÓN — ${persona.apellidosNombres}` : 'SIMULADOR DE DIGITACIÓN — REPORTE GENERAL',
      detalle,
      archivo: persona ? `simulador_digitacion_${persona.cedula.replace(/\D/g, '')}` : 'simulador_digitacion',
      desde: diaEcuador(new Date(p.inicio)),
      hasta: diaEcuador(new Date(p.fin)),
      modo: 'GENERAL',
      // El tamaño depende de las personas, no del rango de fechas.
      limitarDiasPdf: false,
      tablas: tablasReporteSimulador({ ...rep, totales: persona ? totales(filas) : rep.totales }, filas, formato),
    },
    formato,
  );
}
