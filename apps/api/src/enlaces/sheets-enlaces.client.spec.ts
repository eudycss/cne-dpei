const valuesGetMock = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: jest.fn().mockImplementation(() => ({})) },
    sheets: jest.fn(() => ({ spreadsheets: { values: { get: valuesGetMock } } })),
  },
}));

import { SheetsEnlacesClient } from './sheets-enlaces.client';

const HEADER = [
  'PROVINCIA',
  'CODIGO DE RECINTO',
  'LOCALIDAD',
  'FALLO',
];

describe('SheetsEnlacesClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_SHEETS_CREDENTIALS_JSON = '{}';
    process.env.GOOGLE_SHEETS_ID = 'sheet-id';
  });

  it('filtra solo filas de PROVINCIA=IMBABURA y mapea codigo/nombre/estado', async () => {
    valuesGetMock.mockResolvedValue({
      data: {
        values: [
          HEADER,
          ['AZUAY', '1005', 'Escuela Azuay', 'ACTIVO'],
          ['IMBABURA', '982', 'Unidad Educativa Gonzalo Zaldumbide', 'FALLO'],
          ['IMBABURA', '983', 'Otra Escuela Imbabura', 'ACTIVO'],
        ],
      },
    });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows).toEqual([
      { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Gonzalo Zaldumbide', canton: '', estado: 'FALLO' },
      { codigoRecinto: '983', nombreRecinto: 'Otra Escuela Imbabura', canton: '', estado: 'ACTIVO' },
    ]);
  });

  it('mapea la columna CANTON cuando existe en el encabezado', async () => {
    const headerConCanton = ['PROVINCIA', 'CODIGO DE RECINTO', 'LOCALIDAD', 'CANTON', 'FALLO'];
    valuesGetMock.mockResolvedValue({
      data: {
        values: [
          headerConCanton,
          ['IMBABURA', '982', 'Unidad Educativa Gonzalo Zaldumbide', 'Cotacachi', 'FALLO'],
        ],
      },
    });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows).toEqual([
      { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Gonzalo Zaldumbide', canton: 'Cotacachi', estado: 'FALLO' },
    ]);
  });

  it('descarta filas sin código de recinto', async () => {
    valuesGetMock.mockResolvedValue({
      data: { values: [HEADER, ['IMBABURA', '', 'Sin código', 'FALLO']] },
    });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows).toEqual([]);
  });

  it('devuelve arreglo vacío si la hoja no tiene filas de datos', async () => {
    valuesGetMock.mockResolvedValue({ data: { values: [HEADER] } });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows).toEqual([]);
  });

  it('lanza si falta alguna columna requerida en el encabezado (en vez de tratar todo como FALLO)', async () => {
    const headerSinColumnaEstado = ['PROVINCIA', 'CODIGO DE RECINTO', 'LOCALIDAD'];
    valuesGetMock.mockResolvedValue({
      data: { values: [headerSinColumnaEstado, ['IMBABURA', '982', 'Unidad Educativa Gonzalo Zaldumbide']] },
    });
    const client = new SheetsEnlacesClient();

    await expect(client.leerEnlacesImbabura()).rejects.toThrow(/columna/i);
  });

  it('encuentra el encabezado real aunque haya una fila de resumen/totales antes (caso real de la hoja)', async () => {
    const filaResumen = ['1780', '1780', 'ACTUALIZADO 14:10 23-09-2026', '0'];
    valuesGetMock.mockResolvedValue({
      data: {
        values: [
          filaResumen,
          HEADER,
          ['IMBABURA', '982', 'Unidad Educativa Gonzalo Zaldumbide', 'FALLO'],
        ],
      },
    });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows).toEqual([
      { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Gonzalo Zaldumbide', canton: '', estado: 'FALLO' },
    ]);
  });

  it('lanza si ninguna fila parece un encabezado válido', async () => {
    valuesGetMock.mockResolvedValue({
      data: { values: [['1780', '1780'], ['a', 'b', 'c']] },
    });
    const client = new SheetsEnlacesClient();

    await expect(client.leerEnlacesImbabura()).rejects.toThrow(/encabezado/i);
  });
});
