import { redondearA5, sugerirTiempos, type RecintoTiempo } from './tiempos-viaje';

const recinto = (id: string, canton: string, tiempoMin: number | null = null): RecintoTiempo => ({
  id,
  codigo: id.toUpperCase(),
  nombre: `UE ${id}`,
  canton,
  tiempoMin,
});

describe('sugerirTiempos', () => {
  it('redondea hacia arriba a múltiplos de 5', () => {
    expect(redondearA5(47)).toBe(50);
    expect(redondearA5(50)).toBe(50);
    expect(redondearA5(50.2)).toBe(55);
  });

  it('con viajes medidos: el más largo + el margen', () => {
    const [r] = sugerirTiempos([recinto('a', 'IBARRA')], new Map([['a', { maxMin: 42, viajes: 3 }]]), 30);
    expect(r).toMatchObject({ medidoMaxMin: 42, viajesMedidos: 3, sugeridoMin: 75, origenSugerido: 'MEDIDO' });
  });

  it('sin historial: el promedio de lo medido en su cantón + el margen', () => {
    const lista = sugerirTiempos(
      [recinto('a', 'COTACACHI'), recinto('b', 'COTACACHI'), recinto('c', 'COTACACHI')],
      new Map([
        ['a', { maxMin: 40, viajes: 1 }],
        ['b', { maxMin: 60, viajes: 2 }],
      ]),
      30,
    );
    expect(lista[2]).toMatchObject({ medidoMaxMin: null, viajesMedidos: 0, sugeridoMin: 80, origenSugerido: 'CANTON' });
  });

  it('sin historial en el recinto ni en el cantón: sin sugerido', () => {
    const [r] = sugerirTiempos([recinto('a', 'PIMAMPIRO')], new Map([['x', { maxMin: 40, viajes: 1 }]]), 30);
    expect(r).toMatchObject({ sugeridoMin: null, origenSugerido: null });
  });

  it('conserva el tiempo configurado (el sugerido no lo pisa)', () => {
    const [r] = sugerirTiempos([recinto('a', 'IBARRA', 90)], new Map([['a', { maxMin: 20, viajes: 1 }]]), 30);
    expect(r).toMatchObject({ tiempoMin: 90, sugeridoMin: 50 });
  });
});
