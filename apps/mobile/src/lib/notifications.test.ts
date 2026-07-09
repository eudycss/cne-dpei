import { describirNotificacion, formatearFechaHora } from './notifications';
import type { NotificacionItem } from '@cne/shared-types';

jest.mock('./api', () => ({ api: { get: jest.fn(), patch: jest.fn() } }));

function item(tipoEvento: string, payload: Record<string, unknown> = {}): NotificacionItem {
  return { tipoEvento, payload } as unknown as NotificacionItem;
}

describe('describirNotificacion', () => {
  it('SALIDA_DPI', () => {
    expect(describirNotificacion(item('SALIDA_DPI', { operadorNombre: 'Juan', recintoNombre: 'Recinto A' })))
      .toBe('Juan salió del DPI hacia Recinto A');
  });

  it('LLEGADA_RECINTO sin kits', () => {
    expect(describirNotificacion(item('LLEGADA_RECINTO', { operadorNombre: 'Juan', recintoNombre: 'Recinto A' })))
      .toBe('Juan llegó a Recinto A');
  });

  it('LLEGADA_RECINTO con 1 kit (singular)', () => {
    expect(describirNotificacion(item('LLEGADA_RECINTO', { operadorNombre: 'Juan', recintoNombre: 'Recinto A', kitsRecibidos: 1 })))
      .toBe('Juan llegó a Recinto A y recibió 1 kit');
  });

  it('LLEGADA_RECINTO con varios kits (plural)', () => {
    expect(describirNotificacion(item('LLEGADA_RECINTO', { operadorNombre: 'Juan', recintoNombre: 'Recinto A', kitsRecibidos: 3 })))
      .toBe('Juan llegó a Recinto A y recibió 3 kits');
  });

  it('SALIDA_RECINTO', () => {
    expect(describirNotificacion(item('SALIDA_RECINTO', { operadorNombre: 'Juan', recintoNombre: 'Recinto A' })))
      .toBe('Juan salió de Recinto A e inició el retorno al DPI');
  });

  it('LLEGADA_DPI', () => {
    expect(describirNotificacion(item('LLEGADA_DPI', { operadorNombre: 'Juan' })))
      .toBe('Juan llegó al DPI y completó su jornada');
  });

  it('tipoEvento desconocido devuelve el tipo tal cual', () => {
    expect(describirNotificacion(item('OTRO_TIPO'))).toBe('OTRO_TIPO');
  });

  it('usa valores por defecto si falta operadorNombre/recintoNombre', () => {
    expect(describirNotificacion(item('SALIDA_DPI'))).toBe('Un operador salió del DPI hacia su recinto');
  });
});

describe('formatearFechaHora', () => {
  it('formatea una fecha ISO en es-EC', () => {
    const resultado = formatearFechaHora('2026-07-09T15:30:00.000Z');
    expect(typeof resultado).toBe('string');
    expect(resultado.length).toBeGreaterThan(0);
  });
});
