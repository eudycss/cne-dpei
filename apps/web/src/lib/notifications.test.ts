import { describe, it, expect } from 'vitest';
import type { NotificacionItem } from '@cne/shared-types';
import { describirNotificacion, formatearFechaHora } from './notifications';

function notif(overrides: Partial<NotificacionItem> = {}): NotificacionItem {
  return {
    id: 'n1',
    tipoEvento: 'SALIDA_DPI',
    canal: 'PUSH',
    payload: { operadorNombre: 'Ana López', recintoNombre: 'Recinto Central' },
    creadoEn: '2026-06-23T10:00:00.000Z',
    leidaEn: null,
    ...overrides,
  } as NotificacionItem;
}

describe('describirNotificacion', () => {
  it('describe SALIDA_DPI con operador y recinto', () => {
    expect(describirNotificacion(notif({ tipoEvento: 'SALIDA_DPI' }))).toBe(
      'Ana López salió del DPI hacia Recinto Central',
    );
  });

  it('describe LLEGADA_RECINTO incluyendo los kits recibidos (plural)', () => {
    const n = notif({
      tipoEvento: 'LLEGADA_RECINTO',
      payload: { operadorNombre: 'Ana López', recintoNombre: 'Recinto Central', kitsRecibidos: 3 },
    });
    expect(describirNotificacion(n)).toBe('Ana López llegó a Recinto Central y recibió 3 kits');
  });

  it('usa singular cuando recibió un solo kit', () => {
    const n = notif({
      tipoEvento: 'LLEGADA_RECINTO',
      payload: { operadorNombre: 'Ana López', recintoNombre: 'Recinto Central', kitsRecibidos: 1 },
    });
    expect(describirNotificacion(n)).toContain('recibió 1 kit');
    expect(describirNotificacion(n)).not.toContain('1 kits');
  });

  it('omite el sufijo de kits si no viene kitsRecibidos', () => {
    const n = notif({
      tipoEvento: 'LLEGADA_RECINTO',
      payload: { operadorNombre: 'Ana López', recintoNombre: 'Recinto Central' },
    });
    expect(describirNotificacion(n)).toBe('Ana López llegó a Recinto Central');
  });

  it('describe SALIDA_RECINTO y LLEGADA_DPI', () => {
    expect(describirNotificacion(notif({ tipoEvento: 'SALIDA_RECINTO' }))).toBe(
      'Ana López salió de Recinto Central e inició el retorno al DPI',
    );
    expect(describirNotificacion(notif({ tipoEvento: 'LLEGADA_DPI' }))).toBe(
      'Ana López llegó al DPI y completó su jornada',
    );
  });

  it('usa textos por defecto cuando faltan operador y recinto', () => {
    const n = notif({ tipoEvento: 'SALIDA_DPI', payload: {} });
    expect(describirNotificacion(n)).toBe('Un operador salió del DPI hacia su recinto');
  });

  it('cae al tipoEvento crudo para tipos desconocidos', () => {
    const n = notif({ tipoEvento: 'INCIDENCIA' as NotificacionItem['tipoEvento'] });
    expect(describirNotificacion(n)).toBe('INCIDENCIA');
  });
});

describe('formatearFechaHora', () => {
  it('devuelve día/mes y hora:minuto a partir de un ISO', () => {
    // No fijamos el valor exacto (depende de timezone/locale ICU); validamos forma.
    const out = formatearFechaHora('2026-06-23T10:05:00.000Z');
    expect(out).toMatch(/\d{1,2}\/\d{1,2}/); // día/mes
    expect(out).toMatch(/\d{2}:\d{2}/); // hora:minuto
  });
});
