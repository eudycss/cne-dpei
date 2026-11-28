import { describe, expect, it } from 'vitest';
import { duracionTexto, horaConDia, registroLlegadaTexto } from './llegada-dpei';
import { reporteLlegadaDpeiSchema } from './index';

describe('formato del reporte de llegadas a la DPEI', () => {
  it('hora con el día en Ecuador (la noche cruza la medianoche)', () => {
    expect(horaConDia('2026-11-30T07:10:00Z')).toBe('30/11 02:10');
    expect(horaConDia('2026-11-30T02:00:00Z')).toBe('29/11 21:00');
    expect(horaConDia(null)).toBe('—');
  });

  it('duración', () => {
    expect(duracionTexto(95)).toBe('1 h 35 min');
    expect(duracionTexto(40)).toBe('40 min');
    expect(duracionTexto(null)).toBe('—');
  });

  it('cómo se registró la llegada', () => {
    expect(registroLlegadaTexto({ parejasLlegadas: 0, manual: false, porKit: false })).toBe('—');
    expect(registroLlegadaTexto({ parejasLlegadas: 1, manual: false, porKit: false })).toBe('App');
    expect(registroLlegadaTexto({ parejasLlegadas: 2, manual: true, porKit: true })).toBe('Manual (administrador), Por kit');
  });

  it('la fecha del reporte es opcional y AAAA-MM-DD real; nada más', () => {
    expect(reporteLlegadaDpeiSchema.parse({})).toEqual({});
    expect(reporteLlegadaDpeiSchema.parse({ fecha: '2026-11-29' })).toEqual({ fecha: '2026-11-29' });
    expect(reporteLlegadaDpeiSchema.safeParse({ fecha: '2026-02-30' }).success).toBe(false);
    expect(reporteLlegadaDpeiSchema.safeParse({ fecha: '29/11/2026' }).success).toBe(false);
    expect(reporteLlegadaDpeiSchema.safeParse({ otro: '1' }).success).toBe(false);
  });
});
