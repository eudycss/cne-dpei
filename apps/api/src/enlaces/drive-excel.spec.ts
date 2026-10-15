import { Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ArchivoDriveNoConfigurado, descargarExcelDrive, LecturaCacheada, textoCelda } from './drive-excel';

const VARIABLE = 'PRUEBA_DRIVE_ID';

describe('descargarExcelDrive', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env[VARIABLE];
  });

  const respuesta = (cuerpo: ArrayBuffer, extra: Record<string, unknown> = {}) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    arrayBuffer: async () => cuerpo,
    ...extra,
  });

  it('sin la variable avisa que no está configurado, sin llamar a Drive', async () => {
    global.fetch = jest.fn();

    await expect(descargarExcelDrive(VARIABLE)).rejects.toBeInstanceOf(ArchivoDriveNoConfigurado);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rechaza un id con caracteres raros (no arma URLs con lo que venga)', async () => {
    process.env[VARIABLE] = 'abc/../../x?y=1';
    global.fetch = jest.fn();

    await expect(descargarExcelDrive(VARIABLE)).rejects.toThrow(/no es un id de Drive válido/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(['a'.repeat(9), 'a'.repeat(101)])('rechaza un id de largo inválido (%#)', async (id) => {
    process.env[VARIABLE] = id;
    global.fetch = jest.fn();

    await expect(descargarExcelDrive(VARIABLE)).rejects.toThrow(/no es un id de Drive válido/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('un cuerpo de más de 5 MB sin content-length también se rechaza', async () => {
    process.env[VARIABLE] = '1AbCdEfGhIjK_lmn-op';
    global.fetch = jest.fn().mockResolvedValue(respuesta(new ArrayBuffer(6 * 1024 * 1024)));

    await expect(descargarExcelDrive(VARIABLE)).rejects.toThrow(/más de 5 MB/);
  });

  it('un HTTP de error lo dice (una sola vez si los dos enlaces fallan igual)', async () => {
    process.env[VARIABLE] = '1AbCdEfGhIjK_lmn-op';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

    await expect(descargarExcelDrive(VARIABLE)).rejects.toThrow(
      /^Drive respondió HTTP 404 al descargar el archivo de PRUEBA_DRIVE_ID$/,
    );
  });

  it('si Drive anuncia más de 5 MB, lo rechaza sin leer el cuerpo', async () => {
    process.env[VARIABLE] = '1AbCdEfGhIjK_lmn-op';
    const arrayBuffer = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(6 * 1024 * 1024) }),
      arrayBuffer,
    });

    await expect(descargarExcelDrive(VARIABLE)).rejects.toThrow(/más de 5 MB/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('si no es un Excel (Drive devolvió una página de login), lo explica', async () => {
    process.env[VARIABLE] = '1AbCdEfGhIjK_lmn-op';
    global.fetch = jest.fn().mockResolvedValue(respuesta(new TextEncoder().encode('<html>login</html>').buffer as ArrayBuffer));

    await expect(descargarExcelDrive(VARIABLE)).rejects.toThrow(/cualquier persona con el enlace/);
  });

  it('una hoja de cálculo de Google (que no baja por el enlace de Drive) se exporta a Excel', async () => {
    process.env[VARIABLE] = '1AbCdEfGhIjK_lmn-op';
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Hoja').addRow(['hoja de Google']);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(respuesta((await wb.xlsx.writeBuffer()) as ArrayBuffer));

    const leido = await descargarExcelDrive(VARIABLE);

    expect(leido.worksheets[0].getCell('A1').value).toBe('hoja de Google');
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK_lmn-op/export?format=xlsx',
    );
  });

  it('si fallan los dos enlaces, dice ambos motivos', async () => {
    process.env[VARIABLE] = '1AbCdEfGhIjK_lmn-op';
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(respuesta(new TextEncoder().encode('<html>login</html>').buffer as ArrayBuffer));

    await expect(descargarExcelDrive(VARIABLE)).rejects.toThrow(/HTTP 500 .* \/ .*cualquier persona con el enlace/);
  });

  it('descarga por el enlace público, con límite de tiempo, y abre el Excel', async () => {
    process.env[VARIABLE] = '1AbCdEfGhIjK_lmn-op';
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Hoja').addRow(['hola']);
    global.fetch = jest.fn().mockResolvedValue(respuesta((await wb.xlsx.writeBuffer()) as ArrayBuffer));

    const leido = await descargarExcelDrive(VARIABLE);

    expect(leido.worksheets[0].getCell('A1').value).toBe('hola');
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://drive.google.com/uc?export=download&id=1AbCdEfGhIjK_lmn-op');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('textoCelda', () => {
  it.each([
    [null, ''],
    [' 28 ', '28'],
    [1961, '1961'],
    [{ richText: [{ text: 'Ana ' }, { text: 'Pérez' }] }, 'Ana Pérez'],
    [{ formula: 'A1', result: 'x' }, 'x'],
  ])('%p → %p', (valor, esperado) => {
    expect(textoCelda(valor as ExcelJS.CellValue)).toBe(esperado);
  });
});

describe('LecturaCacheada', () => {
  const log = { warn: jest.fn() } as unknown as Logger;

  it('reusa la lectura 10 min y, si después falla, devuelve la última copia', async () => {
    const lectura = new LecturaCacheada<number>(log);
    const leer = jest.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('Drive caído'));

    expect(await lectura.obtener(leer, 0)).toBe(1);
    expect(await lectura.obtener(leer, 9 * 60_000)).toBe(1);
    expect(leer).toHaveBeenCalledTimes(1);
    expect(await lectura.obtener(leer, 11 * 60_000)).toBe(1);
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it('sin copia previa, o si dejó de estar configurado, propaga el error', async () => {
    const lectura = new LecturaCacheada<number>(log);
    await expect(lectura.obtener(() => Promise.reject(new Error('x')), 0)).rejects.toThrow('x');

    await lectura.obtener(() => Promise.resolve(1), 0);
    await expect(
      lectura.obtener(() => Promise.reject(new ArchivoDriveNoConfigurado(VARIABLE)), 11 * 60_000),
    ).rejects.toBeInstanceOf(ArchivoDriveNoConfigurado);
  });
});
