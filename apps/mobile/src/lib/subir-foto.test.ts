import { api, tokenStore } from './api';
import { subirFoto } from './subir-foto';

jest.mock('./api', () => ({ api: { post: jest.fn() }, tokenStore: { getAccess: jest.fn() } }));

const postMock = api.post as jest.Mock;
const error401 = { isAxiosError: true, response: { status: 401 } };
const errorRed = { isAxiosError: true, response: undefined };
const error400 = { isAxiosError: true, response: { status: 400 } };
const error502 = { isAxiosError: true, response: { status: 502 } };

beforeEach(() => {
  jest.clearAllMocks();
  (tokenStore.getAccess as jest.Mock).mockResolvedValue('access-renovado');
});

describe('subirFoto', () => {
  it('sube la foto como multipart y devuelve la respuesta del servidor', async () => {
    postMock.mockResolvedValueOnce({ data: { url: 'u1' } });

    await expect(subirFoto<{ url: string }>('/tracking/foto-acta', 'file:///cache/acta.png')).resolves.toEqual({ url: 'u1' });

    expect(postMock).toHaveBeenCalledTimes(1);
    const [endpoint, form, config] = postMock.mock.calls[0];
    expect(endpoint).toBe('/tracking/foto-acta');
    expect(form).toBeInstanceOf(FormData);
    expect(config.headers).toEqual({ 'Content-Type': 'multipart/form-data' });
  });

  it('con 401 reintenta una vez con un FormData nuevo (no reutiliza el ya enviado)', async () => {
    postMock.mockRejectedValueOnce(error401).mockResolvedValueOnce({ data: { url: 'u2' } });

    await expect(subirFoto('/tracking/foto-militar', 'file:///cache/m.jpg')).resolves.toEqual({ url: 'u2' });

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock.mock.calls[1][1]).not.toBe(postMock.mock.calls[0][1]);
  });

  it('con 401 y la sesión ya cerrada (sin token guardado) no reintenta', async () => {
    (tokenStore.getAccess as jest.Mock).mockResolvedValue(null);
    postMock.mockRejectedValueOnce(error401);
    await expect(subirFoto('/tracking/foto-acta', 'file:///a.jpg')).rejects.toBe(error401);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('si el reintento también falla, lanza ese error (no reintenta más)', async () => {
    postMock.mockRejectedValueOnce(error401).mockRejectedValueOnce(error401);
    await expect(subirFoto('/tracking/foto-acta', 'file:///a.jpg')).rejects.toBe(error401);
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['400 (archivo inválido)', error400],
    ['error de red (lo maneja la lógica offline)', errorRed],
    ['5xx (servidor)', error502],
  ])('con %s no reintenta', async (_n, e) => {
    postMock.mockRejectedValueOnce(e);
    await expect(subirFoto('/tracking/foto-acta', 'file:///a.jpg')).rejects.toBe(e);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('toma el nombre y el tipo del archivo (png o jpeg por defecto)', async () => {
    postMock.mockResolvedValue({ data: {} });
    const append = jest.spyOn(FormData.prototype, 'append');
    await subirFoto('/x', 'file:///cache/foto.PNG');
    await subirFoto('/x', 'file:///cache/sin-extension');
    expect(append).toHaveBeenNthCalledWith(1, 'file', { uri: 'file:///cache/foto.PNG', name: 'foto.PNG', type: 'image/png' });
    expect(append).toHaveBeenNthCalledWith(2, 'file', { uri: 'file:///cache/sin-extension', name: 'sin-extension', type: 'image/jpeg' });
    append.mockRestore();
  });
});
