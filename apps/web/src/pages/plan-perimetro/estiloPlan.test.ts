import { describe, expect, it } from 'vitest';
import { capasDelPlan } from './geometria';
import { MIN_ZOOM_IGM, ORTOFOTOS_IGM, estiloPlan, urlOrtofotoIgm } from './estiloPlan';

const CAPAS = capasDelPlan({
  perimetro: null,
  zonas: [],
  vallas: [],
  ajustes: { pctMujeres: 50, largoValla: 2.5, mostrarNombres: true, alinearVallas: true },
});
const ids = (e: ReturnType<typeof estiloPlan>) => e.layers.map((l) => l.id);

describe('estiloPlan', () => {
  it('satélite y calles: satélite de fondo, calles y nombres encima y el plan arriba de todo', () => {
    const e = estiloPlan('satelite-calles', false, CAPAS);
    expect(ids(e).slice(0, 3)).toEqual(['satelite', 'calles', 'lugares']);
    expect(ids(e).slice(-3)).toEqual(['vallas', 'dibujo-linea', 'dibujo-vertices']);
    expect(e.terrain).toBeUndefined();
  });

  it('solo satélite no pone calles; mapa de calles usa OpenStreetMap', () => {
    expect(ids(estiloPlan('satelite', false, CAPAS))).not.toContain('calles');
    const calles = ids(estiloPlan('calles', false, CAPAS));
    expect(calles[0]).toBe('osm');
    expect(calles).not.toContain('satelite');
  });

  it('en 3D activa el relieve y el sombreado con fuentes de elevación separadas', () => {
    const e = estiloPlan('satelite-calles', true, CAPAS);
    expect(e.terrain).toEqual({ source: 'dem', exaggeration: 1.3 });
    expect(ids(e)).toContain('sombras');
    const sombras = e.layers.find((l) => l.id === 'sombras') as { source: string };
    expect(sombras.source).toBe('dem-sombras');
  });

  it('el satélite se amplía desde el zoom 18 (lo más cerca que hay en Imbabura)', () => {
    const fuente = estiloPlan('satelite', false, CAPAS).sources.satelite as { maxzoom: number; tiles: string[] };
    expect(fuente.maxzoom).toBe(18);
    expect(fuente.tiles[0]).toMatch(/^https:\/\/server\.arcgisonline\.com\/.+World_Imagery.+\{z\}\/\{y\}\/\{x\}$/);
  });

  it('solo usa proveedores sin clave y por HTTPS', () => {
    const e = estiloPlan('satelite-calles', true, CAPAS);
    const urls = Object.values(e.sources).flatMap((s) => ('tiles' in s && s.tiles) || []);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u.startsWith('https://')).toBe(true);
      expect(u).not.toMatch(/key=|token=/i);
    }
  });

  it('ortofoto IGM: Esri de fondo (cubre los huecos), las ortofotos encima y luego calles y nombres', () => {
    const e = estiloPlan('ortofoto', false, CAPAS);
    expect(ids(e).slice(0, 6)).toEqual(['satelite', 'igm-ibarra-2020', 'igm-san-pablo-2020', 'igm-otavalo-2021', 'calles', 'lugares']);
    for (const o of ORTOFOTOS_IGM) {
      const fuente = e.sources[o.id] as { maxzoom: number; minzoom: number; bounds: number[]; tileSize: number };
      // El servidor del IGM falla con zoom 19+ o teselas de 512 px.
      expect(fuente).toMatchObject({ maxzoom: 18, minzoom: MIN_ZOOM_IGM, tileSize: 256, bounds: o.bounds });
    }
    // Las otras capas no piden ortofotos.
    expect(ids(estiloPlan('satelite-calles', false, CAPAS))).not.toContain('igm-ibarra-2020');
  });

  it('la URL del WMS pide 256 px, PNG transparente en EPSG:3857 y deja el comodín del recuadro sin codificar', () => {
    const url = urlOrtofotoIgm('toma2020', 'otf_uxp_20200229_ibarra_30cm_5k');
    expect(url.startsWith('https://www.geoportaligm.gob.ec/orto/toma2020/wms?')).toBe(true);
    expect(url.endsWith('&bbox={bbox-epsg-3857}')).toBe(true);
    const q = new URL(url.replace('{bbox-epsg-3857}', '0,0,1,1')).searchParams;
    expect(Object.fromEntries(q)).toMatchObject({
      request: 'GetMap',
      version: '1.3.0',
      layers: 'otf_uxp_20200229_ibarra_30cm_5k',
      crs: 'EPSG:3857',
      width: '256',
      height: '256',
      format: 'image/png',
      transparent: 'true',
    });
  });

  it('las ortofotos cubren Imbabura: la Delegación y Otavalo caen dentro de alguna', () => {
    const dentro = (lng: number, lat: number) =>
      ORTOFOTOS_IGM.some(({ bounds: [w, s, e, n] }) => lng >= w && lng <= e && lat >= s && lat <= n);
    expect(dentro(-78.11886, 0.35849)).toBe(true);
    expect(dentro(-78.2625, 0.2343)).toBe(true);
  });
});
