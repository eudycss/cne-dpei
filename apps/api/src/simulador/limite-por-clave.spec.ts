import { HttpException } from '@nestjs/common';
import { LimitePorClave } from './limite-por-clave';

describe('LimitePorClave', () => {
  it('deja pasar hasta el límite dentro de la ventana y luego 429', () => {
    const l = new LimitePorClave(3, 60_000, 'Demasiados intentos');
    l.registrar('a', 0);
    l.registrar('a', 1000);
    l.registrar('a', 2000);
    expect(() => l.registrar('a', 3000)).toThrow(HttpException);
    try {
      l.registrar('a', 3000);
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(429);
      expect((e as HttpException).message).toBe('Demasiados intentos');
    }
  });

  it('cada clave cuenta aparte', () => {
    const l = new LimitePorClave(1, 60_000, 'x');
    l.registrar('a', 0);
    expect(() => l.registrar('b', 0)).not.toThrow();
  });

  it('la ventana se desliza: los usos viejos dejan de contar', () => {
    const l = new LimitePorClave(1, 60_000, 'x');
    l.registrar('a', 0);
    expect(() => l.registrar('a', 59_999)).toThrow();
    expect(() => l.registrar('a', 60_001)).not.toThrow();
  });

  it('los rechazos no alargan el bloqueo', () => {
    const l = new LimitePorClave(1, 60_000, 'x');
    l.registrar('a', 0);
    for (let t = 1000; t < 60_000; t += 1000) expect(() => l.registrar('a', t)).toThrow();
    expect(() => l.registrar('a', 60_001)).not.toThrow();
  });

  it('barre las claves vencidas cuando hay demasiadas', () => {
    const l = new LimitePorClave(5, 1000, 'x');
    for (let i = 0; i <= 5000; i++) l.registrar(`c${i}`, 0);
    l.registrar('nueva', 5000);
    expect(l.claves).toBe(1);
  });
});
