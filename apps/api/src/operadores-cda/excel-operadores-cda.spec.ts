import * as ExcelJS from 'exceljs';
import { leerFilasOperadoresCda, normalizarFecha } from './excel-operadores-cda';

/** Hoja como la de talento humano: membrete arriba y encabezados en la fila 9. */
function hojaConMembrete() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.getCell('B1').value = 'DELEGACIÓN PROVINCIAL ELECTORAL DE IMBABURA';
  ws.getCell('A6').value = 'INGRESO DE PERSONAL:';
  ws.getRow(9).values = ['N°', ' Apellidos Nombres', 'Cédula', 'Teléfonos De Contacto', 'Cargo', 'Unidad', 'Inicial'];
  ws.getRow(10).values = [1, 'PÉREZ LÓPEZ ANA MARÍA', '1710034065', '0987923273', 'OPERADOR CDA', 'UPSI', '20 de octubre de 2026'];
  // Cédula y celular guardados como número: Excel les quitó el 0 inicial.
  ws.getRow(11).values = [2, 'RUIZ MORA JUAN', 102030400, 987111222, 'OPERADOR CDA', 'UPSI', new Date(Date.UTC(2026, 9, 21))];
  ws.getRow(12).values = [];
  ws.getRow(13).values = [3, { richText: [{ text: 'VEGA ' }, { text: 'TAPIA LUIS' }] }, '1002003000', '', 'OPERADOR CDA'];
  // Pie de página: no es un operador.
  ws.getRow(15).values = ['TOTAL', '', '', '', '', '', ''];
  return ws;
}

describe('leerFilasOperadoresCda', () => {
  it('encuentra el encabezado debajo del membrete y lee las filas de datos', () => {
    const filas = leerFilasOperadoresCda(hojaConMembrete())!;

    expect(filas.map((f) => f.fila)).toEqual([10, 11, 13]);
    expect(filas[0].datos).toEqual({
      numero: 1,
      apellidosNombres: 'PÉREZ LÓPEZ ANA MARÍA',
      cedula: '1710034065',
      telefono: '0987923273',
      cargo: 'OPERADOR CDA',
      unidad: 'UPSI',
      fechaInicio: '2026-10-20',
    });
  });

  it('repone el 0 inicial de cédulas y celulares guardados como número y lee fechas de Excel', () => {
    const [, segunda] = leerFilasOperadoresCda(hojaConMembrete())!;
    expect(segunda.datos.cedula).toBe('0102030400');
    expect(segunda.datos.telefono).toBe('0987111222');
    expect(segunda.datos.fechaInicio).toBe('2026-10-21');
  });

  it('une el texto enriquecido y omite celdas vacías', () => {
    const tercera = leerFilasOperadoresCda(hojaConMembrete())![2];
    expect(tercera.datos.apellidosNombres).toBe('VEGA TAPIA LUIS');
    expect(tercera.datos).not.toHaveProperty('telefono');
    expect(tercera.datos).not.toHaveProperty('fechaInicio');
  });

  it('lee el texto de celdas con hipervínculo y acepta "Apellidos y Nombres"', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hoja1');
    ws.getRow(1).values = ['Apellidos y Nombres', 'Cédula', 'Cargo'];
    ws.getRow(2).values = [{ text: { richText: [{ text: 'VEGA TAPIA LUIS' }] }, hyperlink: 'mailto:x@y.z' } as unknown as ExcelJS.CellValue, '1002003000', 'OPERADOR CDA'];
    expect(leerFilasOperadoresCda(ws)![0].datos.apellidosNombres).toBe('VEGA TAPIA LUIS');
  });

  it('devuelve null si la hoja no tiene encabezados de operadores', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Otra');
    ws.getRow(1).values = ['cedula', 'nombres', 'apellidos', 'codigo_recinto'];
    expect(leerFilasOperadoresCda(ws)).toBeNull();
  });
});

describe('normalizarFecha', () => {
  it.each([
    ['20 de octubre de 2026', '2026-10-20'],
    ['5 de Septiembre del 2026', '2026-09-05'],
    ['5/9/2026', '2026-09-05'],
    ['2026-10-20', '2026-10-20'],
  ])('%s → %s', (entrada, esperado) => {
    expect(normalizarFecha(entrada)).toBe(esperado);
  });

  it('deja el texto tal cual si no es una fecha reconocible', () => {
    expect(normalizarFecha('32 de octubre de 2026')).toBe('32 de octubre de 2026');
    expect(normalizarFecha('mañana')).toBe('mañana');
  });
});
