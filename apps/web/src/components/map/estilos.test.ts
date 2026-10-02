import { describe, it, expect } from 'vitest';
import { ESTILO_CLARO, ESTILO_OSCURO, estiloMapa } from './estilos';

function fuenteDe(estilo: typeof ESTILO_CLARO) {
  return estilo.sources.osm as { type: string; tiles: string[]; attribution: string };
}

describe('estiloMapa', () => {
  it('elige el estilo según el tema', () => {
    expect(estiloMapa('light')).toBe(ESTILO_CLARO);
    expect(estiloMapa('dark')).toBe(ESTILO_OSCURO);
  });

  it('ambos temas usan teselas raster de OpenStreetMap por HTTPS, sin API key', () => {
    for (const estilo of [ESTILO_CLARO, ESTILO_OSCURO]) {
      const fuente = fuenteDe(estilo);
      expect(fuente.type).toBe('raster');
      expect(fuente.tiles.every((t) => t.startsWith('https://') && t.includes('tile.openstreetmap.org'))).toBe(true);
      expect(fuente.attribution).toContain('OpenStreetMap');
    }
  });

  it('el tema oscuro invierte el brillo y gira el tono; el claro no altera las teselas', () => {
    const capaOscura = ESTILO_OSCURO.layers[0] as { paint?: Record<string, number> };
    expect(capaOscura.paint?.['raster-brightness-min']).toBeGreaterThan(
      capaOscura.paint?.['raster-brightness-max'] ?? 1,
    );
    expect(capaOscura.paint?.['raster-hue-rotate']).toBe(180);
    expect((ESTILO_CLARO.layers[0] as { paint?: unknown }).paint).toBeUndefined();
  });
});
