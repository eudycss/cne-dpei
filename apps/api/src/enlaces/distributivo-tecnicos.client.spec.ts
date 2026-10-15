import * as ExcelJS from 'exceljs';
import {
  DistributivoNoConfigurado,
  DistributivoTecnicosClient,
  leerAsignaciones,
} from './distributivo-tecnicos.client';

/** Un libro como el distributivo real: título, encabezados en la fila 3 y datos. */
function libro(filas: (string | number)[][], encabezado = ['', 'CANTON', 'PARROQUIA', 'CODIGO DE RECINTO', 'LOCALIDAD', 'DIRECCIÓN', 'TECNICOS RESPONSABLES']) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Portada').addRow(['Sin datos']);
  const ws = wb.addWorksheet('RECINTOS DATOS');
  ws.addRow(['']);
  ws.addRow(['', 'Cronograma de visitas técnicas']);
  ws.addRow(encabezado);
  for (const f of filas) ws.addRow(f);
  return wb;
}

describe('leerAsignaciones', () => {
  it('busca la hoja con CODIGO DE RECINTO y TÉCNICOS, y numera a cada técnico por orden de aparición', () => {
    const wb = libro([
      [1, 'IBARRA', 'A', 1126, 'UE Uno', 'x', 'Ana Pérez'],
      [2, 'IBARRA', 'A', 323, 'Plaza Dos', 'x', 'Ana Pérez'],
      [1, 'OTAVALO', 'B', '1225', 'UE Tres', 'x', ' Luis   Mora '],
      [2, 'OTAVALO', 'B', 1008, 'UE Cuatro', 'x', 'luis mora'],
      [3, 'OTAVALO', 'B', '', 'Fila vacía', 'x', 'Ana Pérez'],
      [4, 'OTAVALO', 'B', 999, 'Sin técnico', 'x', ''],
    ]);

    expect(leerAsignaciones(wb)).toEqual([
      { codigoRecinto: '1126', localidad: 'UE Uno', parroquia: 'A', numeroTecnico: 1, tecnico: 'Ana Pérez' },
      { codigoRecinto: '323', localidad: 'Plaza Dos', parroquia: 'A', numeroTecnico: 1, tecnico: 'Ana Pérez' },
      { codigoRecinto: '1225', localidad: 'UE Tres', parroquia: 'B', numeroTecnico: 2, tecnico: 'Luis Mora' },
      { codigoRecinto: '1008', localidad: 'UE Cuatro', parroquia: 'B', numeroTecnico: 2, tecnico: 'luis mora' },
    ]);
  });

  it('acepta encabezados sin tildes o con otro orden de columnas', () => {
    const wb = libro([['Ana', 28]], ['TECNICO RESPONSABLE', 'Codigo de Recinto']);

    expect(leerAsignaciones(wb)).toEqual([
      { codigoRecinto: '28', localidad: '', parroquia: '', numeroTecnico: 1, tecnico: 'Ana' },
    ]);
  });

  it('si ninguna hoja tiene esas columnas, falla con un mensaje claro', () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Hoja1').addRow(['CODIGO', 'NOMBRE']);

    expect(() => leerAsignaciones(wb)).toThrow(/CODIGO DE RECINTO y TECNICOS RESPONSABLES/);
  });
});

describe('DistributivoTecnicosClient', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.DISTRIBUTIVO_TECNICOS_DRIVE_ID;
  });

  async function xlsx(): Promise<ArrayBuffer> {
    const buf = await libro([[1, 'IBARRA', 'A', 28, 'UE Uno', 'x', 'Ana Pérez']]).xlsx.writeBuffer();
    return buf as ArrayBuffer;
  }

  it('sin DISTRIBUTIVO_TECNICOS_DRIVE_ID avisa que no está configurado (sin llamar a Drive)', async () => {
    global.fetch = jest.fn();

    await expect(new DistributivoTecnicosClient().asignaciones()).rejects.toBeInstanceOf(DistributivoNoConfigurado);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rechaza un id con caracteres raros (no arma URLs con lo que venga)', async () => {
    process.env.DISTRIBUTIVO_TECNICOS_DRIVE_ID = 'abc/../../x?y=1';
    global.fetch = jest.fn();

    await expect(new DistributivoTecnicosClient().asignaciones()).rejects.toThrow(/no es un id de Drive válido/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('descarga por el enlace de Drive con límite de tiempo y lee el Excel', async () => {
    process.env.DISTRIBUTIVO_TECNICOS_DRIVE_ID = '1AbCdEfGhIjK_lmn-op';
    const cuerpo = await xlsx();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => cuerpo });

    const r = await new DistributivoTecnicosClient().asignaciones();

    expect(r).toEqual([{ codigoRecinto: '28', localidad: 'UE Uno', parroquia: 'A', numeroTecnico: 1, tecnico: 'Ana Pérez' }]);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://drive.google.com/uc?export=download&id=1AbCdEfGhIjK_lmn-op');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('si Drive devuelve una página en vez del Excel (archivo no compartido), lo explica', async () => {
    process.env.DISTRIBUTIVO_TECNICOS_DRIVE_ID = '1AbCdEfGhIjK_lmn-op';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('<html>login</html>').buffer,
    });

    await expect(new DistributivoTecnicosClient().asignaciones()).rejects.toThrow(/cualquier persona con el enlace/);
  });

  it('guarda la lectura 10 min y, si después Drive falla, usa la última copia', async () => {
    process.env.DISTRIBUTIVO_TECNICOS_DRIVE_ID = '1AbCdEfGhIjK_lmn-op';
    const cuerpo = await xlsx();
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => cuerpo });
    const cliente = new DistributivoTecnicosClient();
    const t0 = 1_000_000;

    const primera = await cliente.asignaciones(t0);
    await cliente.asignaciones(t0 + 5 * 60_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Fallan los dos enlaces de descarga (Drive y exportación de hoja de Google).
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(cliente.asignaciones(t0 + 11 * 60_000)).resolves.toEqual(primera);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
