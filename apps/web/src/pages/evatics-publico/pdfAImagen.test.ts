import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { esPdf, pdfAImagen, MAX_PDF_BYTES, LADO_PDF, PdfIlegibleError } from './pdfAImagen';

function pdfjsFalso({ ancho = 842, alto = 595, falla }: { ancho?: number; alto?: number; falla?: Error } = {}) {
  const render = vi.fn(() => ({ promise: Promise.resolve() }));
  const getViewport = vi.fn(({ scale }: { scale: number }) => ({ width: ancho * scale, height: alto * scale }));
  const destroy = vi.fn(() => Promise.resolve());
  const getPage = vi.fn(() => Promise.resolve({ getViewport, render }));
  const getDocument = vi.fn(() => ({
    promise: falla ? Promise.reject(falla) : Promise.resolve({ getPage }),
    destroy,
  }));
  return { cargar: () => Promise.resolve({ getDocument } as never), getDocument, getPage, render, destroy };
}

const PDF = new File(['%PDF-1.7'], 'certificado.pdf', { type: 'application/pdf' });

describe('pdfAImagen (primera página del certificado en PDF)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
      cb(new Blob(['png'], { type: 'image/png' }));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('reconoce un PDF por su tipo o por la extensión', () => {
    expect(esPdf(PDF)).toBe(true);
    expect(esPdf(new File(['x'], 'CERT.PDF', { type: '' }))).toBe(true);
    expect(esPdf(new File(['x'], 'cert.png', { type: 'image/png' }))).toBe(false);
    expect(esPdf(new Blob(['x'], { type: 'image/jpeg' }))).toBe(false);
  });

  it('dibuja solo la página 1, con el lado mayor en LADO_PDF, y devuelve PNG', async () => {
    const f = pdfjsFalso();
    const imagen = await pdfAImagen(PDF, f.cargar);
    expect(imagen.type).toBe('image/png');
    expect(f.getPage).toHaveBeenCalledWith(1);
    const { canvas } = (f.render.mock.calls[0] as unknown as [{ canvas: HTMLCanvasElement }])[0];
    expect(Math.max(canvas.width, canvas.height)).toBe(LADO_PDF);
    expect(f.destroy).toHaveBeenCalled();
  });

  it('abre el PDF sin formularios XFA', async () => {
    const f = pdfjsFalso();
    await pdfAImagen(PDF, f.cargar);
    expect(f.getDocument).toHaveBeenCalledWith(expect.objectContaining({ enableXfa: false }));
  });

  it('un PDF dañado o con clave da un error claro', async () => {
    const f = pdfjsFalso({ falla: new Error('InvalidPDFException') });
    await expect(pdfAImagen(PDF, f.cargar)).rejects.toThrow(PdfIlegibleError);
    await expect(pdfAImagen(PDF, f.cargar)).rejects.toThrow(/No se pudo abrir el PDF/);
    expect(f.destroy).toHaveBeenCalled();
  });

  it('si el navegador no logra crear la imagen, da el error claro', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
      cb(null);
    });
    const f = pdfjsFalso();
    await expect(pdfAImagen(PDF, f.cargar)).rejects.toThrow(PdfIlegibleError);
    expect(f.destroy).toHaveBeenCalled();
  });

  it('se rinde si el PDF tarda demasiado y libera pdf.js', async () => {
    const f = pdfjsFalso();
    f.render.mockReturnValue({ promise: new Promise<void>(() => {}) });
    await expect(pdfAImagen(PDF, f.cargar, 20)).rejects.toThrow(/tarda demasiado/);
    expect(f.destroy).toHaveBeenCalled();
  });

  it('abre el PDF parando en el primer error', async () => {
    const f = pdfjsFalso();
    await pdfAImagen(PDF, f.cargar);
    expect(f.getDocument).toHaveBeenCalledWith(expect.objectContaining({ stopAtErrors: true }));
  });

  it('no abre PDF de más de 10 MB', async () => {
    const f = pdfjsFalso();
    const grande = new File([new Uint8Array(MAX_PDF_BYTES + 1)], 'g.pdf', { type: 'application/pdf' });
    await expect(pdfAImagen(grande, f.cargar)).rejects.toThrow(/más de 10 MB/);
    expect(f.getDocument).not.toHaveBeenCalled();
  });
});
