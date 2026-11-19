import { describe, expect, it } from 'vitest';
import { capasDelPlan } from './geometria';
import { estiloPlan } from './estiloPlan';

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
});
