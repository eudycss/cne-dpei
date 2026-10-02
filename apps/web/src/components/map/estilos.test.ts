import { describe, it, expect } from 'vitest';
import { ESTILO_CLARO, ESTILO_OSCURO, estiloMapa } from './estilos';

function tilesDe(estilo: typeof ESTILO_CLARO): string[] {
  const fuente = Object.values(estilo.sources)[0] as { tiles: string[] };
  return fuente.tiles;
}

describe('estiloMapa', () => {
  it('usa OpenStreetMap en tema claro y CARTO Dark Matter en tema oscuro', () => {
    expect(estiloMapa('light')).toBe(ESTILO_CLARO);
    expect(estiloMapa('dark')).toBe(ESTILO_OSCURO);
    expect(tilesDe(ESTILO_CLARO)[0]).toContain('tile.openstreetmap.org');
    expect(tilesDe(ESTILO_OSCURO)[0]).toContain('basemaps.cartocdn.com/dark_all');
  });

  it('usa solo teselas raster por HTTPS (sin vector tiles)', () => {
    for (const estilo of [ESTILO_CLARO, ESTILO_OSCURO]) {
      const fuente = Object.values(estilo.sources)[0] as { type: string };
      expect(fuente.type).toBe('raster');
      expect(tilesDe(estilo).every((t) => t.startsWith('https://'))).toBe(true);
    }
  });

  it('el tema oscuro acredita a OpenStreetMap y a CARTO', () => {
    const fuente = Object.values(ESTILO_OSCURO.sources)[0] as { attribution: string };
    expect(fuente.attribution).toContain('OpenStreetMap');
    expect(fuente.attribution).toContain('CARTO');
  });
});
