import { describe, expect, it } from 'vitest';
import { aCampoFechaHora, deCampoFechaHora, fechaHoraEcuador } from './simulador';

describe('fechas del simulador (hora de Ecuador)', () => {
  it('del campo a ISO con zona -05:00', () => {
    expect(deCampoFechaHora('2026-11-10T08:00')).toBe('2026-11-10T08:00:00-05:00');
  });

  it('de ISO (en UTC) al campo, en hora de Ecuador', () => {
    expect(aCampoFechaHora('2026-11-10T13:00:00.000Z')).toBe('2026-11-10T08:00');
    // Cruza la medianoche: 02:30 UTC del 11 son las 21:30 del 10 en Ecuador.
    expect(aCampoFechaHora('2026-11-11T02:30:00.000Z')).toBe('2026-11-10T21:30');
  });

  it('ida y vuelta sin perder la hora', () => {
    expect(aCampoFechaHora(deCampoFechaHora('2026-12-31T23:59'))).toBe('2026-12-31T23:59');
  });

  it('texto corto', () => {
    expect(fechaHoraEcuador('2026-11-10T13:05:00.000Z')).toBe('10/11/2026 08:05');
  });
});
