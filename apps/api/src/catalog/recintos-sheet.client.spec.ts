import * as ExcelJS from 'exceljs';
import { leerRecintosSheet } from './recintos-sheet.client';

const ENCABEZADOS = [
  'CODIGO CANTON',
  'NOMBRE PARROQUIA',
  'NOMBRE ZONA',
  'CODIGO RECINTO',
  'NOMBRE RECINTO',
  'DIRECCION RECINTO',
  'JUN_ FEM',
  'JUN_ MAS',
  'NUMERO ELECTORES',
  'INTERNET',
  'COBERTURA CNT',
  'COBERTURA CLARO',
  'COBERTURA MOVISTAR',
  'long',
  'lat',
  'CDAs',
  'CODIGO CDA O CPE QUE SE TRASLADA',
  'RECINTO REZAGADO O DE DIFICIL ACCESO',
];

type Fila = Partial<Record<(typeof ENCABEZADOS)[number], ExcelJS.CellValue>>;

function fila(f: Fila): ExcelJS.CellValue[] {
  return ENCABEZADOS.map((h) => f[h] ?? null);
}

const base: Fila = {
  'CODIGO CANTON': 30,
  'NOMBRE PARROQUIA': 'SAN FRANCISCO',
  'NOMBRE ZONA': 'SAN FRANCISCO',
  'DIRECCION RECINTO': 'Av. Mariano Acosta',
  'JUN_ FEM': 10,
  'JUN_ MAS': 9,
  'NUMERO ELECTORES': 7000,
  INTERNET: 'SI',
  'COBERTURA CNT': 'NO',
  'COBERTURA CLARO': 'SI',
  'COBERTURA MOVISTAR': 'NO',
  long: -78.1258526048,
  lat: 0.347627096354,
  'RECINTO REZAGADO O DE DIFICIL ACCESO': 'NO',
};

/** Hoja1 con títulos arriba (encabezado en la fila 7) y la hoja de CDAs con encabezado en la fila 1. */
function libro(hoja1: Fila[], cdas: Fila[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const h1 = wb.addWorksheet('Hoja1');
  h1.addRow([]);
  h1.addRow(['Elecciones Seccionales y CPCCS 2023']);
  h1.addRow(['Reporte del Sistema de Recintos Electorales']);
  h1.addRow([]);
  h1.addRow([]);
  h1.addRow([]);
  h1.addRow(ENCABEZADOS);
  hoja1.forEach((f) => h1.addRow(fila(f)));
  const hc = wb.addWorksheet('INFORMACION.TOTAL-CDAS');
  hc.addRow(ENCABEZADOS);
  cdas.forEach((f) => hc.addRow(fila(f)));
  return wb;
}

describe('leerRecintosSheet', () => {
  it('toma los NO CDA de Hoja1 y los CDA de la hoja de CDAs (no los CDA de Hoja1)', () => {
    const wb = libro(
      [
        { ...base, 'CODIGO RECINTO': 182, 'NOMBRE RECINTO': 'Casa Comunal', CDAs: 'NO CDA', 'CODIGO CDA O CPE QUE SE TRASLADA': 28 },
        { ...base, 'CODIGO RECINTO': 1207, 'NOMBRE RECINTO': 'CDA viejo', CDAs: 'CDA', 'CODIGO CDA O CPE QUE SE TRASLADA': 'N/A' },
      ],
      [{ ...base, 'CODIGO RECINTO': 28, 'NOMBRE RECINTO': 'Unidad Educativa Ibarra - 28', CDAs: 'CDA' }],
    );

    const r = leerRecintosSheet(wb);

    expect(r.map((x) => [x.codigoRecinto, x.tipo]).sort()).toEqual([
      ['182', 'NO_CDA'],
      ['28', 'CDA'],
    ]);
    expect(r.find((x) => x.codigoRecinto === '182')?.cdaDestinoCodigo).toBe('28');
  });

  it('quita el código que la hoja de CDAs agrega al final del nombre', () => {
    const wb = libro([], [{ ...base, 'CODIGO RECINTO': 8587, 'NOMBRE RECINTO': 'San Daniel Comboni - Fe y Alegría - 8587', CDAs: 'CDA' }]);

    expect(leerRecintosSheet(wb)[0].nombre).toBe('San Daniel Comboni - Fe y Alegría');
  });

  it('traduce SI/NO, coberturas, juntas, electores y coordenadas', () => {
    const wb = libro([], [{ ...base, 'CODIGO RECINTO': 28, 'NOMBRE RECINTO': 'UE Ibarra', CDAs: 'CDA' }]);

    expect(leerRecintosSheet(wb)[0]).toEqual({
      codigoRecinto: '28',
      nombre: 'UE Ibarra',
      direccion: 'Av. Mariano Acosta',
      cantonCodigo: '30',
      parroquia: 'SAN FRANCISCO',
      zona: 'SAN FRANCISCO',
      tipo: 'CDA',
      cdaDestinoCodigo: null,
      latitud: 0.347627096354,
      longitud: -78.1258526048,
      tieneInternet: true,
      coberturaMovil: true,
      numeroElectores: 7000,
      juntasFemeninas: 10,
      juntasMasculinas: 9,
      esDificilAcceso: false,
    });
  });

  it('salta filas sin código numérico o con un tipo desconocido', () => {
    const wb = libro(
      [
        { ...base, 'CODIGO RECINTO': 'TOTAL', CDAs: 'NO CDA' },
        { ...base, 'CODIGO RECINTO': 300, CDAs: '¿?' },
        { ...base, 'CODIGO RECINTO': 301, 'NOMBRE RECINTO': 'Válido', CDAs: 'NO CDA' },
      ],
      [],
    );

    expect(leerRecintosSheet(wb).map((x) => x.codigoRecinto)).toEqual(['301']);
  });

  it('deja vacíos los textos "N/A" y las coordenadas que no son número', () => {
    const wb = libro(
      [
        {
          ...base,
          'CODIGO RECINTO': 1963,
          'NOMBRE RECINTO': 'Piñán',
          CDAs: 'NO CDA',
          'NOMBRE ZONA': 'N/A',
          'CODIGO CDA O CPE QUE SE TRASLADA': 'CPE-DELEGACION ELECTORAL DE IMBABURA',
          lat: 'sin dato',
        },
      ],
      [],
    );

    const [r] = leerRecintosSheet(wb);
    expect(r.zona).toBeNull();
    expect(r.latitud).toBeNull();
    expect(r.cdaDestinoCodigo).toBe('CPE-DELEGACION ELECTORAL DE IMBABURA');
  });

  it('falla con un mensaje claro si falta una hoja o una columna obligatoria', () => {
    const sinHoja = new ExcelJS.Workbook();
    sinHoja.addWorksheet('Hoja1').addRow(ENCABEZADOS);
    expect(() => leerRecintosSheet(sinHoja)).toThrow(/no tiene la hoja "INFORMACION.TOTAL-CDAS"/);

    const sinColumna = libro([], []);
    sinColumna.getWorksheet('INFORMACION.TOTAL-CDAS')!.getRow(1).getCell(ENCABEZADOS.indexOf('lat') + 1).value = 'LATITUD';
    expect(() => leerRecintosSheet(sinColumna)).toThrow(/no tiene la\(s\) columna\(s\): LAT/);
  });
});
