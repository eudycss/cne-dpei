import { etapaDesdeAsignacion, etapaMasAvanzada } from './etapa-operador';

const sinRegistros = {
  yaRegistroSalida: false,
  yaRegistroLlegada: false,
  yaRegistroSalidaRecinto: false,
  yaRegistroLlegadaDpi: false,
};

describe('etapaDesdeAsignacion', () => {
  it('arranca en SALIDA si el servidor no tiene registros', () => {
    expect(etapaDesdeAsignacion(sinRegistros)).toBe('SALIDA');
  });

  it.each([
    [{ yaRegistroSalida: true }, 'EN_TRANSITO'],
    [{ yaRegistroSalida: true, yaRegistroLlegada: true }, 'EN_RECINTO'],
    [{ yaRegistroSalida: true, yaRegistroLlegada: true, yaRegistroSalidaRecinto: true }, 'EN_RETORNO'],
    [
      { yaRegistroSalida: true, yaRegistroLlegada: true, yaRegistroSalidaRecinto: true, yaRegistroLlegadaDpi: true },
      'RETORNADO',
    ],
  ] as const)('mapea %j a %s', (flags, esperada) => {
    expect(etapaDesdeAsignacion({ ...sinRegistros, ...flags })).toBe(esperada);
  });

  it('usa el registro más avanzado aunque falte uno anterior', () => {
    expect(etapaDesdeAsignacion({ ...sinRegistros, yaRegistroSalidaRecinto: true })).toBe('EN_RETORNO');
  });
});

describe('etapaMasAvanzada', () => {
  it('avanza a lo que dice el servidor si va adelante (hallazgo 3: En tránsito desfasado)', () => {
    expect(etapaMasAvanzada('EN_TRANSITO', 'EN_RETORNO')).toBe('EN_RETORNO');
  });

  it('no retrocede si el servidor va atrás (acción aún en la cola offline)', () => {
    expect(etapaMasAvanzada('EN_RETORNO', 'EN_RECINTO')).toBe('EN_RETORNO');
  });

  it('conserva la pantalla de registro en curso si el servidor aún no la tiene', () => {
    expect(etapaMasAvanzada('LLEGADA', 'EN_TRANSITO')).toBe('LLEGADA');
    expect(etapaMasAvanzada('LLEGADA_DPI', 'EN_RETORNO')).toBe('LLEGADA_DPI');
  });

  it('sale de la pantalla de registro si el servidor ya lo tiene registrado', () => {
    expect(etapaMasAvanzada('LLEGADA', 'EN_RECINTO')).toBe('EN_RECINTO');
  });

  it('es monótona para todos los pares de etapas', () => {
    const orden = ['SALIDA', 'EN_TRANSITO', 'LLEGADA', 'EN_RECINTO', 'EN_RETORNO', 'LLEGADA_DPI', 'RETORNADO'] as const;
    orden.forEach((local, i) =>
      orden.forEach((servidor, j) => {
        expect(etapaMasAvanzada(local, servidor)).toBe(orden[Math.max(i, j)]);
      }),
    );
  });

  it('toma la del servidor si aún no hay etapa local', () => {
    expect(etapaMasAvanzada(null, 'EN_TRANSITO')).toBe('EN_TRANSITO');
  });
});
