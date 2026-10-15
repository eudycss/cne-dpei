import * as ExcelJS from 'exceljs';
import { ArchivoDriveNoConfigurado } from './drive-excel';
import { EncargadosRecintosClient, leerEncargados } from './encargados-recintos.client';

function libro(encabezado: string[], filas: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Portada').addRow(['Encargados de recintos CDA']);
  const ws = wb.addWorksheet('ENCARGADOS');
  ws.addRow(['']);
  ws.addRow(encabezado);
  for (const f of filas) ws.addRow(f);
  return wb;
}

describe('leerEncargados', () => {
  it('lee código, encargado y teléfono de la hoja que los tenga, con encabezados con o sin tildes', () => {
    const wb = libro(
      ['CANTÓN', 'Código de Recinto', 'Encargado del recinto', 'Teléfono'],
      [
        ['IBARRA', 1961, '  Ana   Pérez ', '+593 99 000 0000'],
        ['IBARRA', '323', 'Luis Mora', 990000001],
        ['IBARRA', '', 'Sin código', '0990000002'],
        ['IBARRA', 28, '', ''],
      ],
    );

    expect(leerEncargados(wb)).toEqual(
      new Map([
        ['1961', { nombre: 'Ana Pérez', telefono: '+593 99 000 0000' }],
        // Escrito como número en Excel: se le devuelve el 0 del celular.
        ['323', { nombre: 'Luis Mora', telefono: '0990000001' }],
      ]),
    );
  });

  it('en una columna de código, un código con guion no se parte', () => {
    const wb = libro(['CODIGO DE RECINTO', 'ENCARGADO', 'TELEFONO'], [['01-1299', 'Ana', '0990000000']]);

    expect([...leerEncargados(wb).keys()]).toEqual(['01-1299']);
  });

  it('acepta RESPONSABLE / CELULAR como nombres de columna', () => {
    const wb = libro(['CODIGO DE RECINTO', 'RESPONSABLE', 'CELULAR'], [[28, 'Ana', '0990000000']]);

    expect(leerEncargados(wb).get('28')).toEqual({ nombre: 'Ana', telefono: '0990000000' });
  });

  it('el teléfono solo conserva dígitos, +, espacios, guiones y paréntesis (va a un mensaje HTML)', () => {
    const wb = libro(['CODIGO DE RECINTO', 'ENCARGADO', 'TELEFONO'], [[28, 'Ana', '<b>099</b> 000-0000 ext.']]);

    expect(leerEncargados(wb).get('28')?.telefono).toBe('099 000-0000');
  });

  it('si un recinto aparece dos veces, vale la última fila (la más reciente)', () => {
    const wb = libro(['CODIGO DE RECINTO', 'ENCARGADO', 'TELEFONO'], [[28, 'Ana', '1'], [28, 'Luis', '2']]);

    expect(leerEncargados(wb).get('28')?.nombre).toBe('Luis');
  });

  describe('respuestas del formulario de instalación', () => {
    const ENCABEZADO = [
      'Marca temporal',
      'NOMBRE CDA',
      'Seleccione el CDA',
      'Técnico CNT designado',
      'Número de la persona encargada de la apertura del espacio para el equipo. (nombre, apellido y número)',
    ];

    it('toma el código del final de "Seleccione el CDA" y los contactos tal cual, en una línea', () => {
      const wb = libro(ENCABEZADO, [
        ['2026-08-17', '', 'U. E. Ejemplo - 849', 'Técnico X', 'Lic. Ana Pérez 0990000000,\nLuis Mora   0990000001'],
        ['2026-08-17', '', 'U. E. Sin contacto - 946', 'Técnico X', ''],
      ]);

      expect(leerEncargados(wb)).toEqual(
        new Map([['849', { nombre: 'Lic. Ana Pérez 0990000000, Luis Mora 0990000001', telefono: '' }]]),
      );
    });

    it('no confunde al técnico de CNT con el encargado', () => {
      const wb = libro(ENCABEZADO, [['2026-08-17', '', 'U. E. Ejemplo - 849', 'Técnico X 0980000000', 'Ana 0990000000']]);

      expect(leerEncargados(wb).get('849')?.nombre).toBe('Ana 0990000000');
    });

    it('sin " - código" al final, el valor queda igual; una respuesta sin contacto no pisa a la anterior', () => {
      const wb = libro(ENCABEZADO, [
        ['2026-08-17', '', '849', '', 'Ana 0990000000'],
        ['2026-08-18', '', 'U. E. Ejemplo - 849', '', ''],
        ['2026-08-18', '', 'U. E. Sin código', '', 'Luis 0990000001'],
      ]);

      expect(leerEncargados(wb)).toEqual(
        new Map([
          ['849', { nombre: 'Ana 0990000000', telefono: '' }],
          ['U. E. Sin código', { nombre: 'Luis 0990000001', telefono: '' }],
        ]),
      );
    });

    it('quita caracteres invisibles que podrían disfrazar el texto del aviso', () => {
      const wb = libro(ENCABEZADO, [['2026-08-17', '', 'U. E. Ejemplo - 849', '', 'Ana‮ 099​0000000']]);

      expect(leerEncargados(wb).get('849')?.nombre).toBe('Ana 099 0000000');
    });

    it('un texto muy largo se corta (el aviso no crece sin límite)', () => {
      const wb = libro(ENCABEZADO, [['2026-08-17', '', 'U. E. Ejemplo - 849', '', 'a'.repeat(500)]]);

      expect(leerEncargados(wb).get('849')?.nombre).toHaveLength(200);
    });
  });

  it('sin hoja con esas columnas falla con un mensaje claro', () => {
    const wb = libro(['CODIGO DE RECINTO', 'ENCARGADO'], [[28, 'Ana']]);

    expect(() => leerEncargados(wb)).toThrow(/CODIGO DE RECINTO, ENCARGADO y TELEFONO/);
  });
});

describe('EncargadosRecintosClient', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.ENCARGADOS_RECINTOS_DRIVE_ID;
  });

  it('sin ENCARGADOS_RECINTOS_DRIVE_ID avisa que no está configurado (sin llamar a Drive)', async () => {
    global.fetch = jest.fn();

    await expect(new EncargadosRecintosClient().encargados()).rejects.toBeInstanceOf(ArchivoDriveNoConfigurado);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('descarga el Excel de Drive por su id y lo lee', async () => {
    process.env.ENCARGADOS_RECINTOS_DRIVE_ID = '1AbCdEfGhIjK_lmn-op';
    const cuerpo = (await libro(['CODIGO DE RECINTO', 'ENCARGADO', 'TELEFONO'], [[28, 'Ana', '099']]).xlsx.writeBuffer()) as ArrayBuffer;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => cuerpo });

    const r = await new EncargadosRecintosClient().encargados();

    expect(r.get('28')).toEqual({ nombre: 'Ana', telefono: '099' });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjK_lmn-op',
    );
  });
});
