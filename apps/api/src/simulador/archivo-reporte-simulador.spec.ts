import * as ExcelJS from 'exceljs';
import type { IntentoReporteSimulador, ReporteSimulador } from '@cne/shared-types';

import { archivoReporteSimulador, resultadoIntento } from './archivo-reporte-simulador';
import { FILA_ENCABEZADOS_EXCEL } from '../operadores-cda/reporte-cda';
import { filaPersona, totales } from './reporte-simulador';

const intento = (o: Partial<IntentoReporteSimulador> = {}): IntentoReporteSimulador => ({
  numero: 1,
  cargo: 'Digitadores',
  iniciadoEn: '2026-11-10T14:00:00.000Z',
  terminadoEn: '2026-11-10T14:30:00.000Z',
  motivo: 'TIEMPO',
  minutos: 30,
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
  [intento(), intento({ numero: 2, filasCorrectas: 95 })],
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
      1, '1710034065', 'ANA PÉREZ', '0991234567', 'Digitadores', 'Terminó', 2, 100, 95, 10, 3.3, 30, 10, 'No',
    ]);
    const ausente = general.getRow(FILA_ENCABEZADOS_EXCEL + 2);
    expect(valores(general, FILA_ENCABEZADOS_EXCEL + 2).slice(0, 7)).toEqual([2, '1002003004', 'LUIS MORA', '', 'Digitadores', 'No se presentó', 0]);
    expect((ausente.getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFEE2E2');

    const intentos = wb.getWorksheet('Intentos')!;
    // Solo quien tiene intentos; el mejor marcado.
    expect(intentos.getRow(FILA_ENCABEZADOS_EXCEL + 1).getCell(4).value).toBe(1);
    expect(intentos.getRow(FILA_ENCABEZADOS_EXCEL + 2).getCell(4).value).toBe(2);
    expect(intentos.getRow(FILA_ENCABEZADOS_EXCEL + 2).getCell(COLUMNA_MEJOR).value).toBe('Sí');
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

  it('resultado de cada intento', () => {
    expect(resultadoIntento(intento({ motivo: 'META' }))).toBe('Cumplió la meta');
    expect(resultadoIntento(intento())).toBe('Se acabó el tiempo');
    expect(resultadoIntento(intento({ motivo: null }))).toBe('En curso');
  });
});

/** Última columna de la hoja Intentos: 6 de la persona/intento + 6 cifras + actas sin error + "Mejor". */
const COLUMNA_MEJOR = 14;
