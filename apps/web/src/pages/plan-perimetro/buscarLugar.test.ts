import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarLugares, leerCoordenadas, MAX_LARGO_BUSQUEDA, MAX_RESULTADOS } from './buscarLugar';

describe('leerCoordenadas', () => {
  it.each([
    ['0.3485, -78.1189', [0.3485, -78.1189]],
    ['0.3485 -78.1189', [0.3485, -78.1189]],
    ['  0.3485;-78.1189 ', [0.3485, -78.1189]],
    ['https://www.google.com/maps/@0.3485,-78.1189,17z', [0.3485, -78.1189]],
    ['https://www.google.com/maps/place/Coliseo/@0.35123,-78.12345,18z/data=x', [0.35123, -78.12345]],
    ['https://maps.google.com/?q=0.3485,-78.1189', [0.3485, -78.1189]],
  ])('%s', (texto, esperado) => {
    expect(leerCoordenadas(texto)).toEqual(esperado);
  });

  it.each(['Coliseo Ibarra', '91, 10', '0.3, -200', '', '0.3485'])('"%s" no son coordenadas', (texto) => {
    expect(leerCoordenadas(texto)).toBeNull();
  });
});

describe('buscarLugares', () => {
  afterEach(() => vi.unstubAllGlobals());

  function respuesta(datos: unknown, ok = true) {
    const fetch = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: () => Promise.resolve(datos) });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it('busca en Ecuador con prioridad a Imbabura y en español', async () => {
    const fetch = respuesta([]);
    await buscarLugares('  Coliseo Luis Leoro  ');
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: 'Coliseo Luis Leoro',
      countrycodes: 'ec',
      'accept-language': 'es',
      format: 'jsonv2',
      limit: String(MAX_RESULTADOS),
    });
    expect(url.searchParams.get('viewbox')).toBeTruthy();
  });

  it('separa el nombre del resto de la dirección y descarta resultados sin coordenadas válidas', async () => {
    respuesta([
      { lat: '0.3512', lon: '-78.1234', display_name: 'Coliseo Luis Leoro, Ibarra, Imbabura, Ecuador' },
      { lat: 'x', lon: '-78', display_name: 'Malo' },
      { lat: '95', lon: '-78', display_name: 'Fuera de rango' },
      { lat: '0.1', lon: '-78.1' },
      'basura',
    ]);
    expect(await buscarLugares('coliseo')).toEqual([
      { nombre: 'Coliseo Luis Leoro', detalle: 'Ibarra, Imbabura, Ecuador', lat: 0.3512, lng: -78.1234 },
    ]);
  });

  it('quita el mismo lugar repetido (con y sin tilde) pero deja homónimos lejanos', async () => {
    respuesta([
      { lat: '0.34210', lon: '-78.12310', display_name: 'Estadio Olímpico Ciudad de Ibarra, Ibarra' },
      { lat: '0.34230', lon: '-78.12290', display_name: 'Estadio Olimpico Ciudad de Ibarra, Ibarra' },
      { lat: '0.22', lon: '-78.26', display_name: 'Estadio Olímpico Ciudad de Ibarra, Otavalo' },
    ]);
    expect((await buscarLugares('estadio')).map((l) => l.detalle)).toEqual(['Ibarra', 'Otavalo']);
  });

  it('una respuesta que no es lista da cero resultados; un error HTTP falla', async () => {
    respuesta({ error: 'x' });
    expect(await buscarLugares('x')).toEqual([]);
    respuesta([], false);
    await expect(buscarLugares('x')).rejects.toThrow('503');
  });

  it('no consulta con texto vacío y recorta el texto largo', async () => {
    const fetch = respuesta([]);
    expect(await buscarLugares('   ')).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    await buscarLugares('a'.repeat(500));
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('q')).toHaveLength(MAX_LARGO_BUSQUEDA);
  });
});
