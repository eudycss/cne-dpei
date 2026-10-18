import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Un fondo claro fijo en un style={{...}} no cambia con el modo oscuro y deja
// texto claro sobre blanco (pasó en Recintos, Militares y Asignaciones). Los
// fondos y bordes deben usar las variables del tema de styles.css.
const PROHIBIDOS: [RegExp, string][] = [
  [/background:\s*'#f{3,6}'/i, "fondo blanco fijo ('#fff'): use var(--bg-card)"],
  [/background:\s*'#(f3f4f6|f9fafb|f4f6f8|f0fdf4|d1fae5|fee2e2|fef3c7|e0e7ff|fce7f3)'/i, 'fondo claro fijo: use una variable del tema'],
  [/--color-surface-alt/, '--color-surface-alt no existe en el tema'],
  [/solid #(e5e7eb|d1d5db|f3f4f6)/i, 'borde claro fijo: use var(--border) o var(--border-input)'],
];

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return archivos(ruta);
    return e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx') ? [ruta] : [];
  });
}

describe('colores del tema en las páginas', () => {
  it('no hay fondos ni bordes claros fijos que rompan el modo oscuro', () => {
    const raiz = __dirname;
    const hallazgos = archivos(raiz).flatMap((archivo) =>
      readFileSync(archivo, 'utf8')
        .split('\n')
        .flatMap((linea, i) =>
          PROHIBIDOS.filter(([patron]) => patron.test(linea)).map(
            ([, motivo]) => `${relative(raiz, archivo)}:${i + 1} — ${motivo}`,
          ),
        ),
    );
    expect(hallazgos).toEqual([]);
  });
});
