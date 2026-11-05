import { aplicaA, enmascararNombre, estadoIntento, motivoCierre } from './reglas-simulador';

describe('aplicaA', () => {
  const practica = {
    cargos: [{ cargo: 'DIGITADOR' }],
    personas: [
      { operadorId: 'quitado', incluida: false },
      { operadorId: 'agregado', incluida: true },
    ],
  };

  it.each([
    ['cargo habilitado', { id: 'x', grupo: 'DIGITADOR' }, true],
    ['otro cargo', { id: 'x', grupo: 'OPERADOR' }, false],
    ['quitado aunque su cargo esté habilitado', { id: 'quitado', grupo: 'DIGITADOR' }, false],
    ['agregado con cualquier cargo', { id: 'agregado', grupo: 'OPERADOR' }, true],
  ])('%s', (_caso, persona, esperado) => {
    expect(aplicaA(practica, persona)).toBe(esperado);
  });

  it('sin cargos, solo las personas agregadas', () => {
    const solo = { cargos: [], personas: [{ operadorId: 'a', incluida: true }] };
    expect(aplicaA(solo, { id: 'a', grupo: 'X' })).toBe(true);
    expect(aplicaA(solo, { id: 'b', grupo: 'X' })).toBe(false);
  });
});

describe('enmascararNombre', () => {
  it.each([
    ['CADENA HERRERA JHOSTYN GERARDO', 'C. H. J. G.'],
    ['  ÑUSTE   ÁNGEL ', 'Ñ. Á.'],
    ['UNO', 'U.'],
    ['', ''],
  ])('%p → %p', (nombre, esperado) => {
    expect(enmascararNombre(nombre)).toBe(esperado);
  });
});

describe('estado del intento', () => {
  const T0 = new Date('2026-11-10T14:00:00Z');
  const intento = (o: Partial<Parameters<typeof motivoCierre>[0]> = {}) => ({
    numero: 1,
    iniciadoEn: T0,
    venceEn: new Date(T0.getTime() + 60 * 60_000),
    terminadoEn: null,
    actasCompletadas: 0,
    actasPerfectas: 0,
    ...o,
  });
  const antes = new Date(T0.getTime() + 10 * 60_000);
  const despues = new Date(T0.getTime() + 61 * 60_000);

  it('en curso', () => expect(motivoCierre(intento(), 200, antes)).toBeNull());
  it('meta cumplida', () => expect(motivoCierre(intento({ actasCompletadas: 200 }), 200, antes)).toBe('META'));
  it('tiempo vencido aunque nadie lo cerró', () => expect(motivoCierre(intento(), 200, despues)).toBe('TIEMPO'));
  it('cerrado antes de vencer', () => expect(motivoCierre(intento({ terminadoEn: antes }), 200, antes)).toBe('TIEMPO'));
  it('la meta gana al tiempo', () =>
    expect(motivoCierre(intento({ actasCompletadas: 200, terminadoEn: despues }), 200, despues)).toBe('META'));

  it('arma el estado público', () => {
    const e = estadoIntento(intento({ actasCompletadas: 3, actasPerfectas: 2 }), { nombre: 'P1', metaActas: 200 }, { nombre: 'ANA P.', cargo: 'Digitadores' }, antes);
    expect(e).toEqual({
      practica: 'P1',
      nombre: 'ANA P.',
      cargo: 'Digitadores',
      numeroIntento: 1,
      metaActas: 200,
      completadas: 3,
      perfectas: 2,
      iniciadoEn: T0.toISOString(),
      venceEn: '2026-11-10T15:00:00.000Z',
      terminado: false,
      motivo: null,
    });
  });
});
