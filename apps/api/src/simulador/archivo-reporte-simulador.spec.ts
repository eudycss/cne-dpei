import * as ExcelJS from 'exceljs';
import type { IntentoReporteSimulador, ReporteSimulador } from '@cne/shared-types';

import { archivoReporteSimulador, resultadoIntento, tablasReporteSimulador } from './archivo-reporte-simulador';
import { FILA_ENCABEZADOS_EXCEL } from '../operadores-cda/reporte-cda';
import { filaPersona, totales } from './reporte-simulador';

const intento = (o: Partial<IntentoReporteSimulador> = {}): IntentoReporteSimulador => ({
  id: 'i1',
  numero: 1,
  anulado: false,
  motivoAnulacion: null,
  cargo: 'Digitadores',
  iniciadoEn: '2026-11-10T14:00:00.000Z',
  terminadoEn: '2026-11-10T14:30:00.000Z',
  motivo: 'TIEMPO',
  minutos: 30,
  segundos: 1800,
  actasFaltantes: 190,
  filasDigitadas: 100,
  filasCorrectas: 90,
  filasConError: 10,
  registrosPorMinuto: 3.3,
  actasCompletadas: 10,
  actasPerfectas: 8,
  actasConError: 2,
  cumplio: false,
  ...o,
});

const ana = filaPersona(
  { operadorId: 'a', cedula: '1710034065', apellidosNombres: 'ANA PÉREZ', telefono: '0991234567', cargo: 'Digitadores', asignada: true },
  [intento(), intento({ numero: 2, filasCorrectas: 95, motivo: 'META', cumplio: true, segundos: 1104, actasFaltantes: 0 })],
);
const luis = filaPersona(
  { operadorId: 'b', cedula: '1002003004', apellidosNombres: 'LUIS MORA', telefono: null, cargo: 'Digitadores', asignada: true },
  [],
);
const REP: ReporteSimulador = {
  practica: {
    id: 'x',
    nombre: 'Práctica 1',
    metaActas: 200,
    plazoMinutos: 30,
    filasPorActa: 10,
    inicio: '2026-11-10T13:00:00.000Z',
    fin: '2026-11-11T18:00:00.000Z',
  },
  generadoEn: '2026-11-10T20:00:00.000Z',
  totales: totales([ana, luis]),
  filas: [ana, luis],
};

async function leer(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}
const valores = (ws: ExcelJS.Worksheet, fila: number) => (ws.getRow(fila).values as unknown[]).slice(1);

describe('archivoReporteSimulador', () => {
  it('Excel general: hoja General (mejor intento, ausentes en rojo) e Intentos (todos)', async () => {
    const a = await archivoReporteSimulador(REP, 'xlsx');
    expect(a.nombre).toBe('simulador_digitacion_2026-11-10_2026-11-11.xlsx');
    const wb = await leer(a.contenido);
    const general = wb.getWorksheet('General')!;
    expect(valores(general, FILA_ENCABEZADOS_EXCEL)).toContain('Registros correctos');
    expect(valores(general, FILA_ENCABEZADOS_EXCEL + 1)).toEqual([
      1, '1710034065', 'ANA PÉREZ', '0991234567', 'Digitadores', 'Terminó', 2, 100, 95, 10, 3.3, 10, 'Sí',
      '30:00 · faltaron 190 actas', '18:24',
    ]);
    // Una columna por intento (las del que más intentos tiene); quien no se presentó, vacías.
    expect(valores(general, FILA_ENCABEZADOS_EXCEL)).toEqual(expect.arrayContaining(['Intento 1', 'Intento 2']));
    expect(valores(general, FILA_ENCABEZADOS_EXCEL)).not.toContain('Minutos');
    const ausente = general.getRow(FILA_ENCABEZADOS_EXCEL + 2);
    expect(valores(general, FILA_ENCABEZADOS_EXCEL + 2).slice(0, 7)).toEqual([2, '1002003004', 'LUIS MORA', '', 'Digitadores', 'No se presentó', 0]);
    expect((ausente.getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFEE2E2');

    const intentos = wb.getWorksheet('Intentos')!;
    // Solo quien tiene intentos; el mejor marcado.
    expect(intentos.getRow(FILA_ENCABEZADOS_EXCEL + 1).getCell(4).value).toBe(1);
    expect(intentos.getRow(FILA_ENCABEZADOS_EXCEL + 2).getCell(4).value).toBe(2);
    expect(intentos.getRow(FILA_ENCABEZADOS_EXCEL + 2).getCell(COLUMNA_MEJOR).value).toBe('Sí');
    // "Tiempo" de cada intento, junto al resultado.
    expect(intentos.getRow(FILA_ENCABEZADOS_EXCEL).getCell(COLUMNA_TIEMPO).value).toBe('Tiempo');
    expect(intentos.getRow(FILA_ENCABEZADOS_EXCEL + 1).getCell(COLUMNA_TIEMPO).value).toBe('30:00 · faltaron 190 actas');
    expect(intentos.getRow(FILA_ENCABEZADOS_EXCEL + 2).getCell(COLUMNA_TIEMPO).value).toBe('18:24');
    expect(intentos.getRow(FILA_ENCABEZADOS_EXCEL + 3).getCell(1).value).toBeNull();
  });

  it('individual: solo esa persona, con su cédula en el nombre del archivo', async () => {
    const a = await archivoReporteSimulador(REP, 'xlsx', ana);
    expect(a.nombre).toBe('simulador_digitacion_1710034065_2026-11-10_2026-11-11.xlsx');
    const general = (await leer(a.contenido)).getWorksheet('General')!;
    expect(general.getCell(5, 1).value).toBe('SIMULADOR DE DIGITACIÓN — ANA PÉREZ');
    expect(general.getRow(FILA_ENCABEZADOS_EXCEL + 2).getCell(1).value).toBeNull();
  });

  it('quien ya no está asignada lo dice en el estado', async () => {
    const otra = { ...ana, asignada: false };
    const wb = await leer((await archivoReporteSimulador({ ...REP, filas: [otra] }, 'xlsx')).contenido);
    expect(wb.getWorksheet('General')!.getRow(FILA_ENCABEZADOS_EXCEL + 1).getCell(6).value).toBe('Terminó (ya no asignada)');
  });

  it('PDF', async () => {
    const a = await archivoReporteSimulador(REP, 'pdf');
    expect(a.tipo).toBe('application/pdf');
    expect(a.contenido.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('PDF: el general sin columnas de intento; los tiempos en tablas aparte de a 6, en dos líneas', () => {
    const muchos = filaPersona(
      { operadorId: 'c', cedula: '1003003003', apellidosNombres: 'ROSA VEGA', telefono: null, cargo: 'Digitadores', asignada: true },
      Array.from({ length: 8 }, (_, n) => intento({ numero: n + 1, actasFaltantes: n === 0 ? 1 : 190 })),
    );
    const tablas = tablasReporteSimulador({ ...REP, filas: [ana, luis, muchos] }, [ana, luis, muchos], 'pdf');
    expect(tablas.map((t) => t.titulo)).toEqual([
      'Reporte general (mejor intento de cada persona)',
      'Tiempo de cada intento (intentos 1 a 6)',
      'Tiempo de cada intento (intentos 7 a 8)',
      'Detalle por persona: todos los intentos',
    ]);
    expect(tablas[0].columnas.map((c) => c.titulo)).not.toContain('Intento 1');
    // Solo quien hizo intentos; el que no llegó a ese intento, vacío.
    expect(tablas[1].columnas.map((c) => c.titulo)).toEqual([
      'Nº', 'Cédula', 'Apellidos y nombres', 'Intento 1', 'Intento 2', 'Intento 3', 'Intento 4', 'Intento 5', 'Intento 6',
    ]);
    expect(tablas[1].filas[0]).toEqual([1, '1710034065', 'ANA PÉREZ', '30:00\nfaltaron 190 actas', '18:24', '', '', '', '']);
    expect(tablas[1].filas[1].slice(3, 5)).toEqual(['30:00\nfaltó 1 acta', '30:00\nfaltaron 190 actas']);
    expect(tablas[2].columnas.map((c) => c.titulo).slice(3)).toEqual(['Intento 7', 'Intento 8']);
    expect(tablas[3].filas[0][6]).toBe('30:00\nfaltaron 190 actas');
  });

  it('PDF con 5 intentos: una sola tabla de tiempos', () => {
    const cinco = filaPersona(
      { operadorId: 'c', cedula: '1003003003', apellidosNombres: 'ROSA VEGA', telefono: null, cargo: 'Digitadores', asignada: true },
      Array.from({ length: 5 }, (_, n) => intento({ numero: n + 1 })),
    );
    const tablas = tablasReporteSimulador({ ...REP, filas: [cinco] }, [cinco], 'pdf');
    expect(tablas.map((t) => t.titulo)).toEqual([
      'Reporte general (mejor intento de cada persona)',
      'Tiempo de cada intento',
      'Detalle por persona: todos los intentos',
    ]);
  });

  it('Excel: los tiempos siguen en el General, en una sola línea', () => {
    const tablas = tablasReporteSimulador(REP, REP.filas, 'xlsx');
    expect(tablas).toHaveLength(2);
    expect(tablas[0].filas[0].slice(-2)).toEqual(['30:00 · faltaron 190 actas', '18:24']);
  });

  it('intentos 1 y 3 (falta el 2): el 3 no se pierde en Excel ni en PDF', () => {
    const salteado = filaPersona(
      { operadorId: 'c', cedula: '1003003003', apellidosNombres: 'ROSA VEGA', telefono: null, cargo: 'Digitadores', asignada: true },
      [intento({ numero: 1 }), intento({ numero: 3, actasFaltantes: 1 })],
    );
    const excel = tablasReporteSimulador({ ...REP, filas: [salteado] }, [salteado], 'xlsx');
    expect(excel[0].columnas.map((c) => c.titulo).slice(-3)).toEqual(['Intento 1', 'Intento 2', 'Intento 3']);
    expect(excel[0].filas[0].slice(-2)).toEqual(['', '30:00 · faltó 1 acta']);
    const pdf = tablasReporteSimulador({ ...REP, filas: [salteado] }, [salteado], 'pdf');
    expect(pdf[1].filas[0].slice(-2)).toEqual(['', '30:00\nfaltó 1 acta']);
  });

  it('resultado de cada intento', () => {
    expect(resultadoIntento(intento({ motivo: 'META' }))).toBe('Cumplió la meta');
    expect(resultadoIntento(intento())).toBe('Se acabó el tiempo');
    expect(resultadoIntento(intento({ motivo: null }))).toBe('En curso');
    expect(resultadoIntento(intento({ anulado: true, motivoAnulacion: 'Cerró el navegador' }))).toBe('Anulado: Cerró el navegador');
  });
});

/** Última columna de la hoja Intentos: 6 de la persona/intento + tiempo + 5 cifras + actas sin error + "Mejor". */
const COLUMNA_MEJOR = 14;
const COLUMNA_TIEMPO = 7;
