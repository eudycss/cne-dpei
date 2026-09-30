import { darkColors, lightColors } from './colors';

// Contraste WCAG 2.x: (L1 + 0.05) / (L2 + 0.05) con luminancia relativa sRGB.
function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const TEXTO_NORMAL = 4.5; // WCAG 1.4.3 AA

describe.each([
  ['claro', lightColors],
  ['oscuro', darkColors],
])('contraste del tema %s', (_nombre, c) => {
  it('texto blanco sobre botones primarios (primaryBg)', () => {
    expect(contraste('#ffffff', c.primaryBg)).toBeGreaterThanOrEqual(TEXTO_NORMAL);
  });

  it.each(['bgPage', 'bgCard'] as const)('texto/enlaces "primary" sobre %s', (fondo) => {
    expect(contraste(c.primary, c[fondo])).toBeGreaterThanOrEqual(TEXTO_NORMAL);
  });

  it('texto de advertencia sobre su fondo', () => {
    expect(contraste(c.warningText, c.warningBg)).toBeGreaterThanOrEqual(TEXTO_NORMAL);
  });

  it.each(['textPrimary', 'textMeta'] as const)('%s sobre bgCard', (texto) => {
    expect(contraste(c[texto], c.bgCard)).toBeGreaterThanOrEqual(TEXTO_NORMAL);
  });
});
