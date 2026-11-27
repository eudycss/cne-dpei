import { afterEach, describe, it, expect, vi } from 'vitest';
import { BYTES_OBJETIVO, elegirCalidad, FotoPequenaError, medidasReducidas, reducirFoto } from './reducirFoto';

const blob = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

describe('medidasReducidas', () => {
  it('deja el lado mayor en 800 px sin deformar', () => {
    expect(medidasReducidas(4000, 3000)).toEqual({ ancho: 800, alto: 600 });
    expect(medidasReducidas(3024, 4032)).toEqual({ ancho: 600, alto: 800 });
  });

  it('no agranda una foto pequeña', () => {
    expect(medidasReducidas(640, 480)).toEqual({ ancho: 640, alto: 480 });
  });

  it('nunca devuelve 0 px', () => {
    expect(medidasReducidas(10000, 2)).toEqual({ ancho: 800, alto: 1 });
  });
});

describe('elegirCalidad', () => {
  it('se queda con la primera calidad que pesa menos de 200 KB', async () => {
    const codificar = vi.fn(async (q: number) => blob(q > 0.7 ? BYTES_OBJETIVO + 1 : 150 * 1024));
    const r = await elegirCalidad(codificar);
    expect(r.size).toBe(150 * 1024);
    expect(codificar.mock.calls.map(([q]) => q)).toEqual([0.85, 0.75, 0.65]);
  });

  it('si ninguna llega al objetivo, devuelve la de menor calidad', async () => {
    const codificar = vi.fn(async (q: number) => blob(Math.round(q * 1000_000)));
    const r = await elegirCalidad(codificar);
    expect(r.size).toBe(450_000);
    expect(codificar).toHaveBeenCalledTimes(5);
  });
});

describe('reducirFoto con medida mínima', () => {
  const original = globalThis.createImageBitmap;
  const minimo = { aceptada: (a: number, b: number) => Math.max(a, b) >= 800 && Math.min(a, b) >= 600, mensaje: 'Muy pequeña' };

  /** Imagen de las medidas dadas y un canvas falso que devuelve un JPEG chico. */
  function prepararImagen(width: number, height: number) {
    globalThis.createImageBitmap = vi.fn(async () => ({ width, height, close: vi.fn() })) as unknown as typeof createImageBitmap;
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((cb: (b: Blob) => void) => cb(blob(1000))),
    };
    const crear = vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);
    return { canvas, crear };
  }

  afterEach(() => {
    globalThis.createImageBitmap = original;
    vi.restoreAllMocks();
  });

  it('una foto de 700 × 500 lanza FotoPequenaError con el mensaje y ni siquiera crea el canvas', async () => {
    const { crear } = prepararImagen(700, 500);
    const r = reducirFoto(blob(10), { ladoMaximo: 1600, minimo });
    await expect(r).rejects.toBeInstanceOf(FotoPequenaError);
    await expect(r).rejects.toThrow('Muy pequeña');
    expect(crear).not.toHaveBeenCalled();
  });

  it.each([
    [800, 600, 800, 600],
    [4000, 3000, 1600, 1200],
  ])('%i × %i pasa (se revisa con las medidas ya reducidas: %i × %i)', async (w, h, anchoFinal, altoFinal) => {
    const { canvas } = prepararImagen(w, h);
    await expect(reducirFoto(blob(10), { ladoMaximo: 1600, minimo })).resolves.toBeInstanceOf(Blob);
    expect([canvas.width, canvas.height]).toEqual([anchoFinal, altoFinal]);
  });

  it('una panorámica que al reducirse queda baja no pasa', async () => {
    prepararImagen(4000, 1200); // reducida: 1600 × 480
    await expect(reducirFoto(blob(10), { ladoMaximo: 1600, minimo })).rejects.toBeInstanceOf(FotoPequenaError);
  });

  it('sin `minimo` no valida medidas (credencial y Evatics)', async () => {
    prepararImagen(300, 200);
    await expect(reducirFoto(blob(10))).resolves.toBeInstanceOf(Blob);
  });
});
