import type { FilaReporteSimulador, FormatoReporteCda, IntentoReporteSimulador, ReporteSimulador } from '@cne/shared-types';

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

const COLUMNAS_GENERAL: ColumnaReporte[] = [
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
  { titulo: 'Minutos', ancho: 12 },
  { titulo: 'Actas', ancho: 9 },
  { titulo: 'Cumplió', ancho: 11 },
];

const COLUMNAS_INTENTOS: ColumnaReporte[] = [
  { titulo: 'Cédula', ancho: 15 },
  { titulo: 'Apellidos y nombres', ancho: 24 },
  { titulo: 'Cargo', ancho: 16 },
  { titulo: 'Intento', ancho: 10 },
  { titulo: 'Inicio', ancho: 14 },
  { titulo: 'Resultado', ancho: 14 },
  REG('Registros digitados'),
  REG('Registros correctos'),
  REG('Registros con error'),
  { titulo: 'Por minuto', ancho: 11 },
  { titulo: 'Minutos', ancho: 12 },
  { titulo: 'Actas', ancho: 9 },
  { titulo: 'Actas sin error', ancho: 11 },
  { titulo: 'Mejor', ancho: 9 },
];

const registros = (i: IntentoReporteSimulador | null): Celda[] =>
  i ? [i.filasDigitadas, i.filasCorrectas, i.filasConError, i.registrosPorMinuto, i.minutos, i.actasCompletadas] : ['', '', '', '', '', ''];

function tablaGeneral(rep: ReporteSimulador, filas: FilaReporteSimulador[]): TablaReporte {
  const t = rep.totales;
  return {
    hoja: 'General',
    titulo: 'Reporte general (mejor intento de cada persona)',
    columnas: COLUMNAS_GENERAL,
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

function tablaIntentos(filas: FilaReporteSimulador[]): TablaReporte {
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
        ...registros(i),
        i.actasPerfectas,
        i.numero === f.mejor ? 'Sí' : '',
      ]),
    ),
  };
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
      tablas: [tablaGeneral({ ...rep, totales: persona ? totales(filas) : rep.totales }, filas), tablaIntentos(filas)],
    },
    formato,
  );
}
