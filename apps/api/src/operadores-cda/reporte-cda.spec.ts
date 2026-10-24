import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import { ANCHO_HORIZONTAL, nuevoPdf, tabla } from '../common/pdf';
import {
  FILA_ENCABEZADOS_EXCEL,
  type ReporteCda,
  agruparPorDia,
  diaCorto,
  diaLargo,
  enviarReporte,
  generarReporte,
  parsearModo,
} from './reporte-cda';

const base: ReporteCda = {
  titulo: 'Reporte de prueba',
  detalle: 'Del 01/10/2026 al 02/10/2026',
  archivo: 'prueba',
  desde: '2026-10-01',
  hasta: '2026-10-02',
  modo: 'GENERAL',
  tablas: [
    {
      hoja: 'Una hoja con un nombre de más de treinta y un caracteres',
      titulo: 'Tabla',
      columnas: [
        { titulo: 'Nombre', ancho: 30 },
        { titulo: 'Minutos', ancho: 10 },
      ],
      filas: [
        ['ANA', 5],
        ['BRUNO', ''],
      ],
    },
  ],
};

describe('reporte-cda', () => {
  it('formatea días en español y en dd/mm/aaaa sin corrimiento de zona', () => {
    expect(diaLargo('2026-10-23')).toBe('viernes, 23 de octubre de 2026');
    expect(diaLargo('2026-01-01')).toBe('jueves, 1 de enero de 2026');
    expect(diaCorto('2026-10-03')).toBe('03/10/2026');
  });

  it('agrupa por fecha conservando el orden de llegada', () => {
    const g = agruparPorDia([
      { fecha: '2026-10-01', n: 1 },
      { fecha: '2026-10-02', n: 2 },
      { fecha: '2026-10-01', n: 3 },
    ]);
    expect([...g.keys()]).toEqual(['2026-10-01', '2026-10-02']);
    expect(g.get('2026-10-01')!.map((x) => x.n)).toEqual([1, 3]);
  });

  it('el modo es GENERAL por defecto y rechaza otros valores con 400', () => {
    expect(parsearModo(undefined)).toBe('GENERAL');
    expect(parsearModo('POR_DIA')).toBe('POR_DIA');
    expect(() => parsearModo('x')).toThrow(BadRequestException);
  });

  it('Excel: encabezado institucional, encabezados en su fila y nombre de hoja recortado a 31', async () => {
    const a = await generarReporte(base, 'xlsx');
    expect(a.nombre).toBe('prueba_2026-10-01_2026-10-02.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(a.contenido as never);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe(base.tablas[0].hoja.slice(0, 31));
    expect(ws.getCell('A4').value).toBe('CONSEJO NACIONAL ELECTORAL — DELEGACIÓN PROVINCIAL DE IMBABURA');
    expect(ws.getCell('A5').value).toBe('Reporte de prueba');
    expect(String(ws.getCell('A7').value)).toMatch(/^Del 01\/10\/2026 al 02\/10\/2026 · Generado el /);
    expect(ws.getRow(FILA_ENCABEZADOS_EXCEL).values).toEqual([undefined, 'Nombre', 'Minutos']);
    expect(ws.getRow(FILA_ENCABEZADOS_EXCEL + 1).values).toEqual([undefined, 'ANA', 5]);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: FILA_ENCABEZADOS_EXCEL });
  });

  it('PDF: una página por tabla y pie con número de página', async () => {
    const dos = { ...base, modo: 'POR_DIA' as const, tablas: [base.tablas[0], { ...base.tablas[0], hoja: 'Otra' }] };
    const a = await generarReporte(dos, 'pdf');
    expect(a.nombre).toBe('prueba_2026-10-01_2026-10-02_por_dia.pdf');
    const texto = a.contenido.toString('latin1');
    expect(texto.startsWith('%PDF-')).toBe(true);
    expect(texto.match(/\/Type \/Page\b/g)).toHaveLength(2);
  });

  it('PDF: más de 31 días se rechaza (Excel no tiene ese tope)', async () => {
    const largo = { ...base, desde: '2026-09-01', hasta: '2026-10-02' };
    await expect(generarReporte(largo, 'pdf')).rejects.toThrow('En PDF el rango máximo es de 31 días');
    await expect(generarReporte({ ...largo, desde: '2026-09-02' }, 'pdf')).resolves.toMatchObject({ tipo: 'application/pdf' });
    await expect(generarReporte(largo, 'xlsx')).resolves.toBeDefined();
  });

  it('PDF: al pasar de página la tabla repite sus encabezados', async () => {
    const { doc, terminado } = nuevoPdf('landscape', { paginar: true });
    const texto = jest.spyOn(doc, 'text');
    doc.addPage();
    tabla(doc, ['Nombre', 'Minutos'], [0.7, 0.3], Array.from({ length: 60 }, (_, i) => [`OP ${i}`, String(i)]), ANCHO_HORIZONTAL);
    const paginas = doc.bufferedPageRange().count;
    doc.end();
    await terminado;

    expect(paginas).toBeGreaterThan(1);
    expect(texto.mock.calls.filter((c) => c[0] === 'Minutos')).toHaveLength(paginas);
  });

  it('enviarReporte manda el archivo como adjunto y sin caché', () => {
    const res = { setHeader: jest.fn(), send: jest.fn() };
    const contenido = Buffer.from('x');
    enviarReporte(res as never, { nombre: 'a_2026-10-01_2026-10-01.pdf', tipo: 'application/pdf', contenido });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="a_2026-10-01_2026-10-01.pdf"');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.send).toHaveBeenCalledWith(contenido);
  });
});
