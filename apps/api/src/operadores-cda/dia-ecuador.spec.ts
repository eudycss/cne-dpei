import { diaEcuador, diasEntre, horaEcuador } from './dia-ecuador';

describe('dia-ecuador', () => {
  it('a las 19:30 de Ecuador sigue siendo el mismo día aunque en UTC ya sea mañana', () => {
    // 2026-10-23 00:30 UTC = 2026-10-22 19:30 en Ecuador (UTC-5).
    expect(diaEcuador(new Date('2026-10-23T00:30:00Z'))).toBe('2026-10-22');
    expect(diaEcuador(new Date('2026-10-23T05:00:00Z'))).toBe('2026-10-23');
  });

  it('formatea la hora en Ecuador (24 h), con 00 a medianoche y nunca 24', () => {
    expect(horaEcuador(new Date('2026-10-23T00:30:00Z'))).toBe('19:30');
    expect(horaEcuador(new Date('2026-10-23T05:05:00Z'))).toBe('00:05');
  });

  it('cambia de día exactamente a la medianoche de Ecuador', () => {
    expect(diaEcuador(new Date('2026-10-23T04:59:59Z'))).toBe('2026-10-22');
    expect(diaEcuador(new Date('2026-10-23T05:00:00Z'))).toBe('2026-10-23');
  });

  it('lista los días de un rango, ambos incluidos, cruzando de mes', () => {
    expect(diasEntre('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(diasEntre('2026-10-22', '2026-10-22')).toEqual(['2026-10-22']);
  });
});
