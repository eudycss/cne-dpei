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

  it('devuelve una sola entrada por código aunque la hoja lo repita (pasaba con el CPE)', async () => {
    valuesGetMock.mockResolvedValue({
      data: {
        values: [
          HEADER,
          ['IMBABURA', '1207', 'UE Repetida', 'FALLO'],
          ['IMBABURA', '982', 'Escuela', 'ACTIVO'],
          ['IMBABURA', '1207', 'UE Repetida', 'FALLO'],
        ],
      },
    });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows.map((r) => r.codigoRecinto)).toEqual(['1207', '982']);
  });

  it.each([
    ['ACTIVO', 'FALLO'],
    ['FALLO', 'ACTIVO'],
  ])('con filas repetidas %s y %s, cuenta como FALLO (no oculta un enlace caído)', async (primero, segundo) => {
    valuesGetMock.mockResolvedValue({
      data: {
        values: [
          HEADER,
          ['IMBABURA', '1207', 'UE Repetida', primero],
          ['IMBABURA', '1207', 'UE Repetida', segundo],
        ],
      },
    });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows).toEqual([
      { codigoRecinto: '1207', nombreRecinto: 'UE Repetida', canton: '', estado: 'FALLO' },
    ]);
  });

  it('con filas repetidas ambas ACTIVO, queda ACTIVO', async () => {
    valuesGetMock.mockResolvedValue({
      data: {
        values: [
          HEADER,
          ['IMBABURA', '1207', 'UE Repetida', 'ACTIVO'],
          ['IMBABURA', '1207', 'UE Repetida', 'ACTIVO'],
        ],
      },
    });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows).toHaveLength(1);
    expect(rows[0].estado).toBe('ACTIVO');
  });

  it('descarta filas sin código de recinto', async () => {
    valuesGetMock.mockResolvedValue({
      data: { values: [HEADER, ['IMBABURA', '', 'Sin código', 'FALLO']] },
    });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows).toEqual([]);
  });

  it('descarta el CPE: no es un recinto y no se monitorea', async () => {
    valuesGetMock.mockResolvedValue({
      data: {
        values: [
          HEADER,
          ['IMBABURA', 'CPE', 'CPE - IMBABURA', 'FALLO'],
          ['IMBABURA', '982', 'Unidad Educativa Zaldumbide', 'FALLO'],
        ],
      },
    });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows.map((r) => r.codigoRecinto)).toEqual(['982']);
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
