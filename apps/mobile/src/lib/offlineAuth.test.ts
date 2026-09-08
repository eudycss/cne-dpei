jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: jest.fn((_algo: string, data: string) => Promise.resolve(`H(${data})`)),
  getRandomBytesAsync: jest.fn((n: number) =>
    Promise.resolve(new Uint8Array(Array.from({ length: n }, (_, i) => i))),
  ),
}));

jest.mock('expo-secure-store', () => {
  let store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
    __getStore: () => store,
    __reset: () => {
      store = {};
    },
  };
});

import * as SecureStore from 'expo-secure-store';
import {
  guardarVerificadorOffline,
  limpiarVerificadorOffline,
  verificarLoginOffline,
} from './offlineAuth';

const storeMock = SecureStore as unknown as { __getStore: () => Record<string, string>; __reset: () => void };

const usuario = {
  id: 'u1',
  email: 'Operador@cne-imbabura.gob.ec',
  nombres: 'Ana',
  apellidos: 'Perez',
  debeCambiarPwd: false,
  roles: ['OPERADOR_CDA'] as const,
};

describe('offlineAuth', () => {
  beforeEach(() => {
    storeMock.__reset();
    jest.clearAllMocks();
  });

  it('permite el login offline con el email y la contraseña correctos (email case-insensitive)', async () => {
    await guardarVerificadorOffline('Secreto123!', usuario as any);

    const resultado = await verificarLoginOffline('operador@cne-imbabura.gob.ec', 'Secreto123!');

    expect(resultado).toEqual({ ok: true, usuario });
  });

  it('rechaza una contraseña incorrecta', async () => {
    await guardarVerificadorOffline('Secreto123!', usuario as any);

    const resultado = await verificarLoginOffline(usuario.email, 'OtraClave!');

    expect(resultado).toEqual({ ok: false, razon: 'invalido' });
  });

  it('rechaza un email distinto al del verificador guardado', async () => {
    await guardarVerificadorOffline('Secreto123!', usuario as any);

    const resultado = await verificarLoginOffline('otro@cne-imbabura.gob.ec', 'Secreto123!');

    expect(resultado).toEqual({ ok: false, razon: 'invalido' });
  });

  it('devuelve "sin-verificador" si nunca se guardó uno en este dispositivo', async () => {
    const resultado = await verificarLoginOffline(usuario.email, 'Secreto123!');

    expect(resultado).toEqual({ ok: false, razon: 'sin-verificador' });
  });

  it('devuelve "vencido" si pasaron más de 7 días desde el último login online', async () => {
    await guardarVerificadorOffline('Secreto123!', usuario as any);

    const store = storeMock.__getStore();
    const guardado = JSON.parse(store['cne.offline_auth']);
    const hace8dias = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    store['cne.offline_auth'] = JSON.stringify({ ...guardado, guardadoEn: hace8dias });

    const resultado = await verificarLoginOffline(usuario.email, 'Secreto123!');

    expect(resultado).toEqual({ ok: false, razon: 'vencido' });
  });

  it('sigue vigente justo antes de cumplir 7 días', async () => {
    await guardarVerificadorOffline('Secreto123!', usuario as any);

    const store = storeMock.__getStore();
    const guardado = JSON.parse(store['cne.offline_auth']);
    const hace6dias23h = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000)).toISOString();
    store['cne.offline_auth'] = JSON.stringify({ ...guardado, guardadoEn: hace6dias23h });

    const resultado = await verificarLoginOffline(usuario.email, 'Secreto123!');

    expect(resultado).toEqual({ ok: true, usuario });
  });

  it('limpiarVerificadorOffline borra el verificador guardado', async () => {
    await guardarVerificadorOffline('Secreto123!', usuario as any);

    await limpiarVerificadorOffline();

    const resultado = await verificarLoginOffline(usuario.email, 'Secreto123!');
    expect(resultado).toEqual({ ok: false, razon: 'sin-verificador' });
  });
});
