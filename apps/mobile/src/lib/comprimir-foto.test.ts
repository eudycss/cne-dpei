const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulate(...args),
  SaveFormat: { JPEG: 'jpeg' },
}));

const mockGetSize = jest.fn();
jest.mock('react-native', () => ({
  Image: { getSize: (...args: unknown[]) => mockGetSize(...args) },
}));

import { CALIDAD_JPEG, comprimirFoto, redimension } from './comprimir-foto';

function tamano(width: number, height: number) {
  mockGetSize.mockImplementation((_uri: string, ok: (w: number, h: number) => void) => ok(width, height));
}

describe('redimension', () => {
  it('reduce por el lado más largo, conservando la proporción', () => {
    expect(redimension(4000, 3000)).toEqual({ width: 1600 }); // horizontal
    expect(redimension(3000, 4000)).toEqual({ height: 1600 }); // vertical
  });

  it('no agranda fotos que ya son pequeñas', () => {
    expect(redimension(1200, 900)).toBeNull();
    expect(redimension(1600, 1200)).toBeNull();
  });
});

describe('comprimirFoto', () => {
  beforeEach(() => {
    mockManipulate.mockReset();
    mockGetSize.mockReset();
  });

  it('redimensiona una foto grande y la devuelve en JPEG base64', async () => {
    tamano(4000, 3000);
    mockManipulate.mockResolvedValue({ uri: 'file:///chica.jpg', base64: 'QUJD', width: 1600, height: 1200 });

    const r = await comprimirFoto('file:///grande.jpg');

    expect(mockManipulate).toHaveBeenCalledWith('file:///grande.jpg', [{ resize: { width: 1600 } }], {
      compress: CALIDAD_JPEG,
      format: 'jpeg',
      base64: true,
    });
    expect(r).toEqual({ uri: 'file:///chica.jpg', base64: 'QUJD' });
  });

  it('a una foto pequeña solo la recomprime, sin redimensionar', async () => {
    tamano(1024, 768);
    mockManipulate.mockResolvedValue({ uri: 'file:///x.jpg', base64: 'QQ==' });

    await comprimirFoto('file:///p.jpg');

    expect(mockManipulate.mock.calls[0][1]).toEqual([]);
  });

  it('si no puede medir o comprimir devuelve null (se envía la original)', async () => {
    mockGetSize.mockImplementation((_u: string, _ok: unknown, error: (e: Error) => void) => error(new Error('sin acceso')));
    expect(await comprimirFoto('file:///a.jpg')).toBeNull();

    tamano(4000, 3000);
    mockManipulate.mockRejectedValue(new Error('falló'));
    expect(await comprimirFoto('file:///a.jpg')).toBeNull();

    mockManipulate.mockResolvedValue({ uri: 'file:///b.jpg' }); // sin base64
    expect(await comprimirFoto('file:///a.jpg')).toBeNull();
  });
});
