import PDFDocument from 'pdfkit';

import { carnetsPdf } from './carnet-cda.pdf';

const carnet = (i: number) => ({
  grupo: 'OPERADOR CDA',
  nombre: `OPERADOR ${i}`,
  cargo: 'OPERADOR CDA',
  token: `CDA1${'A'.repeat(26)}`,
  foto: null,
});

describe('carnetsPdf', () => {
  it('10 carnets por hoja A4 (no Carta): 11 carnets son 2 páginas', async () => {
    const pdf = (await carnetsPdf(Array.from({ length: 11 }, (_, i) => carnet(i)), new Date())).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    const paginas = pdf.match(/\/MediaBox \[[^\]]+\]/g)!;
    expect(paginas).toHaveLength(2);
    for (const p of paginas) expect(p).toBe('/MediaBox [0 0 595.28 841.89]');
  });

  it('el encabezado del carnet dice el grupo (OPERADOR CDA o ASISTENTE CDA)', async () => {
    const texto = jest.spyOn(PDFDocument.prototype, 'text');
    await carnetsPdf([carnet(1), { ...carnet(2), grupo: 'ASISTENTE CDA' }], new Date());
    const textos = texto.mock.calls.map((c) => c[0]);
    expect(textos).toContain('OPERADOR CDA');
    expect(textos).toContain('ASISTENTE CDA');
    texto.mockRestore();
  });

  it('el carnet lleva fecha Y hora de emisión (Ecuador): dos emisiones del mismo día se distinguen', async () => {
    const texto = jest.spyOn(PDFDocument.prototype, 'text');
    await carnetsPdf([carnet(1)], new Date('2026-10-24T16:19:00Z'));
    const textos = texto.mock.calls.map((c) => String(c[0]));
    expect(textos).toContain('Emitido 24/10/2026 11:19 · Personal e intransferible');
    texto.mockRestore();
  });

  it('al reimprimir, cada carnet lleva su propia fecha de emisión (no la de hoy)', async () => {
    const texto = jest.spyOn(PDFDocument.prototype, 'text');
    await carnetsPdf([{ ...carnet(1), emitidoEn: new Date('2026-10-20T15:00:00Z') }, carnet(2)], new Date('2026-10-24T16:19:00Z'));
    const textos = texto.mock.calls.map((c) => String(c[0]));
    expect(textos).toContain('Emitido 20/10/2026 10:00 · Personal e intransferible');
    expect(textos).toContain('Emitido 24/10/2026 11:19 · Personal e intransferible');
    texto.mockRestore();
  });

  it('una foto dañada no impide generar el carnet', async () => {
    const pdf = await carnetsPdf([{ ...carnet(1), foto: Buffer.from('no es un jpeg') }], new Date());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
