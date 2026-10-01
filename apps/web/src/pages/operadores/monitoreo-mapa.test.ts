import { describe, it, expect } from 'vitest';
import {
  desplazamientosMarcadores,
  distanciaMetros,
  estaSinSenal,
  formatearDuracion,
  minutosDesde,
} from './monitoreo-mapa';

const AHORA = new Date('2026-10-01T17:15:00.000Z').getTime();

describe('minutosDesde / estaSinSenal', () => {
  it('calcula los minutos transcurridos y nunca devuelve negativos', () => {
    expect(minutosDesde('2026-10-01T16:48:00.000Z', AHORA)).toBe(27);
    expect(minutosDesde('2026-10-01T17:20:00.000Z', AHORA)).toBe(0);
  });

  it('marca sin señal a partir de 10 minutos', () => {
    expect(estaSinSenal('2026-10-01T17:05:30.000Z', AHORA)).toBe(false); // 9 min
    expect(estaSinSenal('2026-10-01T17:05:00.000Z', AHORA)).toBe(true); // 10 min
  });

  it('trata una fecha inválida como sin señal', () => {
    expect(estaSinSenal('no-es-fecha', AHORA)).toBe(true);
    expect(formatearDuracion(minutosDesde('no-es-fecha', AHORA))).toBe('un tiempo desconocido');
  });
});

describe('formatearDuracion', () => {
  it('usa minutos bajo una hora y horas con minutos a partir de ahí', () => {
    expect(formatearDuracion(27)).toBe('27 min');
    expect(formatearDuracion(65)).toBe('1 h 05 min');
  });
});

describe('distanciaMetros', () => {
  it('da ~12 m entre las posiciones reales de Jairo y Willy', () => {
    const d = distanciaMetros([0.2315582, -78.6282684], [0.2315933, -78.6283783]);
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(15);
  });
});

describe('desplazamientosMarcadores', () => {
  it('no desplaza a operadores que están lejos entre sí', () => {
    const r = desplazamientosMarcadores([
      { operadorId: 'a', latitud: 0.35, longitud: -78.12 },
      { operadorId: 'b', latitud: 0.23, longitud: -78.62 },
    ]);
    expect(r.get('a')).toEqual([0, 0]);
    expect(r.get('b')).toEqual([0, 0]);
  });

  it('separa en direcciones distintas a dos operadores en el mismo punto', () => {
    const r = desplazamientosMarcadores([
      { operadorId: 'willy', latitud: 0.2315933, longitud: -78.6283783 },
      { operadorId: 'jairo', latitud: 0.2315582, longitud: -78.6282684 },
    ]);
    const a = r.get('jairo')!;
    const b = r.get('willy')!;
    expect(a).not.toEqual([0, 0]);
    expect(b).not.toEqual([0, 0]);
    expect(a).not.toEqual(b);
  });

  it('es estable sin importar el orden de entrada', () => {
    const ops = [
      { operadorId: 'x', latitud: 0.2, longitud: -78.6 },
      { operadorId: 'y', latitud: 0.2, longitud: -78.6 },
      { operadorId: 'z', latitud: 0.2, longitud: -78.6 },
    ];
    expect(desplazamientosMarcadores(ops)).toEqual(desplazamientosMarcadores([...ops].reverse()));
  });
});
