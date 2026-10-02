import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Cargando } from './Cargando';

describe('Cargando', () => {
  it('anuncia la carga en español y oculta la animación (que anuncia en inglés)', () => {
    const { container } = render(<Cargando texto="Cargando estado de CDAs…" />);

    const estados = screen.getAllByRole('status');
    // Solo el anuncio propio es accesible; el role="status" de LatticeLoader queda bajo aria-hidden.
    const visibles = estados.filter((e) => !e.closest('[aria-hidden="true"]'));
    expect(visibles).toHaveLength(1);
    expect(visibles[0]).toHaveTextContent('Cargando estado de CDAs…');
    // El texto en inglés de LatticeLoader existe en el DOM, pero dentro de aria-hidden.
    const ingles = Array.from(container.querySelectorAll('*')).find(
      (el) => el.children.length === 0 && /in progress/.test(el.textContent ?? ''),
    );
    expect(ingles?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('usa "Cargando…" por defecto', () => {
    render(<Cargando />);
    expect(screen.getAllByRole('status').some((e) => e.textContent === 'Cargando…')).toBe(true);
  });
});
