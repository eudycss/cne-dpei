import { CAIDAS_INTERMITENTE, clasificarIntermitencia, evaluarLectura } from './antiparpadeo';

describe('evaluarLectura', () => {
  it('un recinto nunca visto espera a la siguiente lectura', () => {
    expect(evaluarLectura('FALLO', null)).toEqual({ confirmado: null, cambio: null });
    expect(evaluarLectura('ACTIVO', null)).toEqual({ confirmado: null, cambio: null });
  });

  it('una lectura distinta de la anterior no confirma nada (puede ser un parpadeo)', () => {
    expect(evaluarLectura('FALLO', { estado: 'ACTIVO', estadoConfirmado: 'ACTIVO' })).toEqual({
      confirmado: 'ACTIVO',
      cambio: null,
    });
    expect(evaluarLectura('ACTIVO', { estado: 'FALLO', estadoConfirmado: 'FALLO' })).toEqual({
      confirmado: 'FALLO',
      cambio: null,
    });
  });

  it('dos lecturas en FALLO sobre un ACTIVO confirmado: caída', () => {
    expect(evaluarLectura('FALLO', { estado: 'FALLO', estadoConfirmado: 'ACTIVO' })).toEqual({
      confirmado: 'FALLO',
      cambio: 'CAIDA',
    });
  });

  it('dos lecturas en ACTIVO sobre un FALLO confirmado: recuperación', () => {
    expect(evaluarLectura('ACTIVO', { estado: 'ACTIVO', estadoConfirmado: 'FALLO' })).toEqual({
      confirmado: 'ACTIVO',
      cambio: 'RECUPERACION',
    });
  });

  it('sin cambios respecto a lo confirmado: nada que avisar', () => {
    expect(evaluarLectura('FALLO', { estado: 'FALLO', estadoConfirmado: 'FALLO' }).cambio).toBeNull();
    expect(evaluarLectura('ACTIVO', { estado: 'ACTIVO', estadoConfirmado: 'ACTIVO' }).cambio).toBeNull();
  });

  it('sin nada confirmado: el primer FALLO estable es caída (no queda mudo); el primer ACTIVO no es recuperación', () => {
    expect(evaluarLectura('FALLO', { estado: 'FALLO', estadoConfirmado: null })).toEqual({
      confirmado: 'FALLO',
      cambio: 'CAIDA',
    });
    expect(evaluarLectura('ACTIVO', { estado: 'ACTIVO' })).toEqual({ confirmado: 'ACTIVO', cambio: null });
  });
});

describe('clasificarIntermitencia', () => {
  it('por debajo del umbral, aviso normal', () => {
    expect(clasificarIntermitencia('CAIDA', CAIDAS_INTERMITENTE - 1)).toBe('avisar');
    expect(clasificarIntermitencia('RECUPERACION', CAIDAS_INTERMITENTE - 1)).toBe('avisar');
  });

  it('la caída que llega justo al umbral se marca una vez', () => {
    expect(clasificarIntermitencia('CAIDA', CAIDAS_INTERMITENTE)).toBe('marcar');
  });

  it('pasado el umbral, la caída se omite', () => {
    expect(clasificarIntermitencia('CAIDA', CAIDAS_INTERMITENTE + 1)).toBe('omitir');
  });

  it('la recuperación de un intermitente siempre se avisa (si no, el grupo lo cree caído)', () => {
    expect(clasificarIntermitencia('RECUPERACION', CAIDAS_INTERMITENTE)).toBe('avisar');
    expect(clasificarIntermitencia('RECUPERACION', CAIDAS_INTERMITENTE + 5)).toBe('avisar');
  });
});
