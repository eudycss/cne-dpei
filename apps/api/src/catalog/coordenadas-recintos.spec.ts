import { analizarCoordenadas, distanciaMetros, mediana, parseUmbral, type MarcaRecinto, type RecintoCoordenada } from './coordenadas-recintos';

const rec = (id: string, lat = 0.227472, lng = -78.632139): RecintoCoordenada => ({
  id,
  codigo: id,
  nombre: `UE ${id}`,
  canton: 'COTACACHI',
  lat,
  lng,
});
const marca = (lat: number, lng: number, metros: number): MarcaRecinto => ({ lat, lng, metros });

describe('mediana', () => {
  it('toma el valor central (impar) o la media de los dos centrales (par)', () => {
    expect(mediana([5, 1, 3])).toBe(3);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('distanciaMetros', () => {
  it('es 0 en el mismo punto y ~610 m entre la coordenada de García Moreno y su punto real', () => {
    expect(distanciaMetros(0.2, -78.6, 0.2, -78.6)).toBe(0);
    const d = distanciaMetros(0.227472, -78.632139, 0.231491, -78.628385);
    expect(d).toBeGreaterThan(590);
    expect(d).toBeLessThan(630);
  });
});

describe('parseUmbral', () => {
  it('acepta 10-5000 y cualquier otra cosa vale 150', () => {
    expect(parseUmbral('300')).toBe(300);
    expect(parseUmbral('10')).toBe(10);
    expect(parseUmbral('5000')).toBe(5000);
    for (const malo of [undefined, '', '  ', 'abc', '5', '99999', ['a', 'b'], null]) expect(parseUmbral(malo)).toBe(150);
  });
});

describe('analizarCoordenadas', () => {
  it('la mediana igual al umbral no es sospechosa (solo la que lo supera)', () => {
    const marcas = new Map([['a', [marca(0.23, -78.63, 150), marca(0.23, -78.63, 150), marca(0.23, -78.63, 150)]]]);
    expect(analizarCoordenadas([rec('a')], marcas)[0].sospechosa).toBe(false);
  });

  it('con exactamente el mínimo de marcaciones sí propone', () => {
    const marcas = new Map([['a', [marca(0.23, -78.63, 300), marca(0.23, -78.63, 300), marca(0.23, -78.63, 300)]]]);
    expect(analizarCoordenadas([rec('a')], marcas)[0]).toMatchObject({ marcas: 3, latPropuesta: 0.23, sospechosa: true });
  });

  it('las marcaciones a más de 2 km no entran en la propuesta pero se cuentan', () => {
    const marcas = new Map([
      ['a', [marca(0.2315, -78.6284, 620), marca(0.2314, -78.6283, 630), marca(0.2316, -78.6285, 640), marca(0.9, -78.9, 5000)]],
    ]);
    expect(analizarCoordenadas([rec('a')], marcas)[0]).toMatchObject({ marcas: 3, marcasLejanas: 1, medianaMetros: 630 });
  });

  it('un recinto con solo marcaciones lejanas (coordenada muy corrida) es sospechoso y no propone', () => {
    const lejos = [marca(0.3, -78.5, 9000), marca(0.3, -78.5, 9100), marca(0.3, -78.5, 9200)];
    const [f] = analizarCoordenadas([rec('a')], new Map([['a', lejos]]));
    expect(f).toMatchObject({ marcas: 0, marcasLejanas: 3, sospechosa: true, latPropuesta: null, desfaseMetros: null, medianaMetros: 9100 });
    // Con menos del mínimo no se asegura nada.
    expect(analizarCoordenadas([rec('a')], new Map([['a', lejos.slice(0, 2)]]))[0].sospechosa).toBe(false);
  });

  it('propone la mediana de las marcaciones y marca como sospechosa la que supera el umbral', () => {
    const marcas = new Map([['a', [marca(0.2315, -78.6284, 620), marca(0.2314, -78.6283, 630), marca(0.2316, -78.6285, 640), marca(0.5, -78.9, 1900)]]]);
    const [f] = analizarCoordenadas([rec('a')], marcas);
    expect(f.sospechosa).toBe(true);
    expect(f.marcas).toBe(4);
    expect(f.medianaMetros).toBe(635);
    // La marca lejana (outlier) no arrastra la propuesta: la mediana de 4 valores promedia los dos centrales.
    expect(f.latPropuesta).toBeCloseTo(0.23155, 5);
    expect(f.lngPropuesta).toBeCloseTo(-78.62845, 5);
    expect(f.desfaseMetros).toBeGreaterThan(500);
  });

  it('un recinto cuya mediana no supera el umbral no es sospechoso', () => {
    const marcas = new Map([['a', [marca(0.2275, -78.6322, 40), marca(0.2274, -78.6321, 60), marca(0.2276, -78.6323, 80)]]]);
    expect(analizarCoordenadas([rec('a')], marcas)[0].sospechosa).toBe(false);
  });

  it('con menos marcaciones que el mínimo no propone coordenada ni lo marca sospechoso', () => {
    const marcas = new Map([['a', [marca(0.23, -78.63, 600), marca(0.23, -78.63, 650)]]]);
    const [f] = analizarCoordenadas([rec('a')], marcas);
    expect(f).toMatchObject({ marcas: 2, latPropuesta: null, lngPropuesta: null, desfaseMetros: null, sospechosa: false });
  });

  it('omite los recintos sin marcaciones y ordena primero los sospechosos más desfasados', () => {
    const tres = (metros: number) => [marca(0.23, -78.63, metros), marca(0.23, -78.63, metros), marca(0.23, -78.63, metros)];
    const marcas = new Map([
      ['ok', tres(20)],
      ['mal', tres(300)],
      ['peor', tres(700)],
    ]);
    const r = analizarCoordenadas([rec('ok'), rec('sin'), rec('mal'), rec('peor')], marcas);
    expect(r.map((x) => x.id)).toEqual(['peor', 'mal', 'ok']);
  });

  it('el umbral es configurable', () => {
    const marcas = new Map([['a', [marca(0.23, -78.63, 200), marca(0.23, -78.63, 200), marca(0.23, -78.63, 200)]]]);
    expect(analizarCoordenadas([rec('a')], marcas, 150)[0].sospechosa).toBe(true);
    expect(analizarCoordenadas([rec('a')], marcas, 250)[0].sospechosa).toBe(false);
  });
});
