import { describe, expect, it } from 'vitest';
import { api, apiPublico, tokenStore } from './api';

/** Handlers registrados en un interceptor de axios (no es API pública de axios, pero es estable). */
const cantidad = (i: unknown) => ((i as { handlers?: unknown[] }).handlers ?? []).filter(Boolean).length;

describe('apiPublico (páginas sin sesión)', () => {
  it('no tiene interceptores: no agrega el token del usuario ni redirige al login ante un 401', () => {
    expect(cantidad(apiPublico.interceptors.request)).toBe(0);
    expect(cantidad(apiPublico.interceptors.response)).toBe(0);
    // El cliente normal sí los tiene (control de que la medición sirve).
    expect(cantidad(api.interceptors.request)).toBeGreaterThan(0);
  });

  it('aunque haya una sesión de administrador en el equipo, sus cabeceras no llevan Authorization', () => {
    tokenStore.set('acceso-admin', 'refresh-admin');
    try {
      expect(apiPublico.defaults.headers.common.Authorization).toBeUndefined();
    } finally {
      tokenStore.clear();
    }
  });

  it('apunta a la misma API', () => {
    expect(apiPublico.defaults.baseURL).toBe(api.defaults.baseURL);
  });
});
