import * as ExcelJS from 'exceljs';

import { FILA_ENCABEZADOS_EXCEL, generarReporte } from './reporte-cda';
import { type CargoReporte, type PersonaReporte, reportePersonal } from './reporte-personal-cda';

const OPERADOR: CargoReporte = { clave: 'OPERADOR', nombre: 'Operadores CDA', centro: 'CDA', orden: 1 };
const ASISTENTE: CargoReporte = { clave: 'ASISTENTE', nombre: 'Asistentes CDA', centro: 'CDA', orden: 2 };
const DIGITADOR: CargoReporte = { clave: 'DIGITADOR', nombre: 'Digitadores', centro: 'CPE', orden: 3 };

const p = (apellidosNombres: string, grupo: string, cedula = '1000000000'): PersonaReporte => ({ apellidosNombres, cedula, grupo });

const PERSONAS = [
  p('ZAMBRANO LUIS', 'OPERADOR', '1000000001'),
  p('VEGA ANA', 'DIGITADOR', '1000000002'),
  p('ÁLVAREZ JUAN', 'OPERADOR', '1000000003'),
  p('BENÍTEZ ROSA', 'ASISTENTE', '1000000004'),
];

describe('reportePersonal', () => {
  it('general: resumen con totales y una tabla ordenada por cargo y apellido', () => {
    const r = reportePersonal([DIGITADOR, OPERADOR, ASISTENTE], PERSONAS, 'GENERAL', '2026-11-27');
    expect(r.titulo).toBe('Personal CDA y CPE');
    expect(r.archivo).toBe('personal_cda_cpe');
    expect(r.tablas).toHaveLength(2);
    expect(r.tablas[0].filas).toEqual([
      ['Operadores CDA', 'CDA', 2],
      ['Asistentes CDA', 'CDA', 1],
      ['Digitadores', 'CPE', 1],
      ['TOTAL', '', 4],
    ]);
    expect(r.tablas[1].filas).toEqual([
      [1, 'ÁLVAREZ JUAN', '1000000003', 'Operadores CDA', 'CDA'],
      [2, 'ZAMBRANO LUIS', '1000000001', 'Operadores CDA', 'CDA'],
      [3, 'BENÍTEZ ROSA', '1000000004', 'Asistentes CDA', 'CDA'],
      [4, 'VEGA ANA', '1000000002', 'Digitadores', 'CPE'],
    ]);
  });

  it('por cargo: una tabla por cargo, también la de un cargo sin personal', () => {
    const r = reportePersonal([OPERADOR, ASISTENTE], [p('PÉREZ JOSÉ', 'OPERADOR')], 'POR_CARGO', '2026-11-27');
    expect(r.titulo).toBe('Personal CDA');
    expect(r.archivo).toBe('personal_cda_por_cargo');
    expect(r.tablas.map((t) => t.hoja)).toEqual(['Resumen', 'Operadores CDA', 'Asistentes CDA']);
    expect(r.tablas[1].titulo).toBe('Operadores CDA (CDA) — 1 persona');
    expect(r.tablas[2].filas).toEqual([['No hay personal activo en los cargos elegidos.']]);
  });

  it('no incluye personas de cargos que no se eligieron', () => {
    const r = reportePersonal([DIGITADOR], PERSONAS, 'GENERAL', '2026-11-27');
    expect(r.tablas[1].filas).toEqual([[1, 'VEGA ANA', '1000000002', 'Digitadores', 'CPE']]);
    expect(r.tablas[0].filas.at(-1)).toEqual(['TOTAL', '', 1]);
  });

  it('nombres de hoja que Excel acepta: sin caracteres prohibidos, 31 como máximo y sin repetir', () => {
    const largo = 'Técnicos de sala / apoyo: turno [noche] con nombre larguísimo';
    const a = { clave: 'A', nombre: largo, centro: 'CPE', orden: 1 } as CargoReporte;
    const b = { clave: 'B', nombre: largo, centro: 'CPE', orden: 2 } as CargoReporte;
    const hojas = reportePersonal([a, b], [], 'POR_CARGO', '2026-11-27').tablas.map((t) => t.hoja);
    expect(hojas.slice(1).every((h) => h.length <= 31 && !/[\\/?*[\]:]/.test(h))).toBe(true);
    expect(new Set(hojas.map((h) => h.toLowerCase())).size).toBe(hojas.length);
  });

  it('sin espacios ni apóstrofos en los extremos y sin el nombre reservado "Historial"', () => {
    const c = (clave: string, nombre: string, orden: number) => ({ clave, nombre, centro: 'CPE', orden }) as CargoReporte;
    const hojas = reportePersonal(
      [c('A', "'Apoyo'", 1), c('B', 'Historial', 2), c('C', 'Operador de escáner de turno con nombre largo', 3)],
      [],
      'POR_CARGO',
      '2026-11-27',
    ).tablas.map((t) => t.hoja);
    expect(hojas).toEqual(['Resumen', 'Apoyo', 'Cargo', 'Operador de escáner de turno co']);
    expect(hojas.every((h) => h === h.trim())).toBe(true);
  });

  it('el Excel trae el resumen y el listado en sus hojas', async () => {
    const archivo = await generarReporte(reportePersonal([OPERADOR, DIGITADOR], PERSONAS, 'POR_CARGO', '2026-11-27'), 'xlsx');
    expect(archivo.nombre).toBe('personal_cda_cpe_por_cargo_2026-11-27.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(archivo.contenido as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumen', 'Operadores CDA', 'Digitadores']);
    const ws = wb.getWorksheet('Operadores CDA')!;
    expect(ws.getRow(FILA_ENCABEZADOS_EXCEL).getCell(2).value).toBe('Apellidos y nombres');
    expect(ws.getRow(FILA_ENCABEZADOS_EXCEL + 1).getCell(2).value).toBe('ÁLVAREZ JUAN');
  });

  it('el PDF se genera', async () => {
    const archivo = await generarReporte(reportePersonal([OPERADOR], PERSONAS, 'GENERAL', '2026-11-27'), 'pdf');
    expect(archivo.tipo).toBe('application/pdf');
    expect(archivo.contenido.subarray(0, 4).toString()).toBe('%PDF');
  });
});
