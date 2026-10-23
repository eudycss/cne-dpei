import { describe, it, expect, vi } from 'vitest';
import { BYTES_OBJETIVO, elegirCalidad, medidasReducidas } from './reducirFoto';

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
