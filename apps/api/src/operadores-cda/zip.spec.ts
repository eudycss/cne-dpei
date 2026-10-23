import * as ExcelJS from 'exceljs';
import { tamanoDescomprimidoZip } from './zip';

describe('tamanoDescomprimidoZip', () => {
  it('suma el tamaño descomprimido de un .xlsx real sin descomprimirlo', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Hoja1').getCell('A1').value = 'hola';
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const total = tamanoDescomprimidoZip(buf)!;
    expect(total).toBeGreaterThan(buf.length / 4);
    expect(total).toBeLessThan(1024 * 1024);
  });

  it('devuelve null si no es un ZIP o está truncado', () => {
    expect(tamanoDescomprimidoZip(Buffer.from('no es un zip'))).toBeNull();
    expect(tamanoDescomprimidoZip(Buffer.alloc(0))).toBeNull();
  });
});
