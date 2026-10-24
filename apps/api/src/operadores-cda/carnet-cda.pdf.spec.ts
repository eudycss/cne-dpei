import { carnetsPdf } from './carnet-cda.pdf';

const carnet = (i: number) => ({
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

  it('una foto dañada no impide generar el carnet', async () => {
    const pdf = await carnetsPdf([{ ...carnet(1), foto: Buffer.from('no es un jpeg') }], new Date());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
