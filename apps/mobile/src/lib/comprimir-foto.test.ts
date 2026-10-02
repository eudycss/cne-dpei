const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulate(...args),
  SaveFormat: { JPEG: 'jpeg' },
}));

const mockGetSize = jest.fn();
jest.mock('react-native', () => ({
  Image: { getSize: (...args: unknown[]) => mockGetSize(...args) },
}));

const mockDelete = jest.fn();
jest.mock('expo-file-system', () => ({
  deleteAsync: (...args: unknown[]) => mockDelete(...args),
}));

import { CALIDAD_JPEG, comprimirFoto, redimension } from './comprimir-foto';

function tamano(width: number, height: number) {
  mockGetSize.mockImplementation((_uri: string, ok: (w: number, h: number) => void) => ok(width, height));
}

const OPCIONES = { compress: CALIDAD_JPEG, format: 'jpeg', base64: true };

describe('redimension', () => {
  it('reduce por el lado más largo, conservando la proporción', () => {
    expect(redimension(4000, 3000)).toEqual({ width: 1600 }); // horizontal
    expect(redimension(3000, 4000)).toEqual({ height: 1600 }); // vertical
  });

  it('no agranda fotos que ya son pequeñas (límite exacto incluido)', () => {
    expect(redimension(1200, 900)).toBeNull();
    expect(redimension(1600, 1200)).toBeNull();
    expect(redimension(1600, 1600)).toBeNull();
  });

  it('reduce apenas el lado mayor pasa del límite', () => {
    expect(redimension(1601, 900)).toEqual({ width: 1600 });
    expect(redimension(1601, 1601)).toEqual({ width: 1600 }); // cuadrada
  });
});

describe('comprimirFoto', () => {
  beforeEach(() => {
    mockManipulate.mockReset();
    mockGetSize.mockReset();
    mockDelete.mockReset().mockResolvedValue(undefined);
  });

  it('redimensiona una foto grande, devuelve el JPEG en base64 y borra el temporal', async () => {
    tamano(4000, 3000);
    mockManipulate.mockResolvedValue({ uri: 'file:///chica.jpg', base64: 'QUJD', width: 1600, height: 1200 });

    const r = await comprimirFoto('file:///grande.jpg');

    expect(mockManipulate).toHaveBeenCalledWith('file:///grande.jpg', [{ resize: { width: 1600 } }], OPCIONES);
    expect(r).toBe('QUJD');
    expect(mockDelete).toHaveBeenCalledWith('file:///chica.jpg', { idempotent: true });
  });

  it('a una foto pequeña solo la recomprime, con las mismas opciones', async () => {
    tamano(1024, 768);
    mockManipulate.mockResolvedValue({ uri: 'file:///x.jpg', base64: 'QQ==' });

    await comprimirFoto('file:///p.jpg');

    expect(mockManipulate).toHaveBeenCalledWith('file:///p.jpg', [], OPCIONES);
  });

  it('si no puede medir o comprimir devuelve null (se envía la original)', async () => {
    mockGetSize.mockImplementation((_u: string, _ok: unknown, error: (e: Error) => void) => error(new Error('sin acceso')));
    expect(await comprimirFoto('file:///a.jpg')).toBeNull();

    tamano(4000, 3000);
    mockManipulate.mockRejectedValue(new Error('falló'));
    expect(await comprimirFoto('file:///a.jpg')).toBeNull();

    mockManipulate.mockResolvedValue({ uri: 'file:///b.jpg' }); // sin base64
    expect(await comprimirFoto('file:///a.jpg')).toBeNull();
    expect(mockDelete).toHaveBeenCalledWith('file:///b.jpg', { idempotent: true });
  });

  it('un error al borrar el temporal no afecta el resultado', async () => {
    tamano(4000, 3000);
    mockManipulate.mockResolvedValue({ uri: 'file:///c.jpg', base64: 'Qw==' });
    mockDelete.mockRejectedValue(new Error('no se pudo borrar'));

    expect(await comprimirFoto('file:///a.jpg')).toBe('Qw==');
  });
});
