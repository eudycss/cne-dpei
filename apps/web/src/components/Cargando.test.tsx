import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('./micro/LatticeLoader/LatticeLoader', () => ({
  default: ({ label }: { label: string }) => <span role="status">{label}, in progress</span>,
}));

import { Cargando } from './Cargando';

describe('Cargando', () => {
  it('expone un único anuncio en español; el del loader (en inglés) queda oculto', () => {
    render(<Cargando texto="Cargando estado de CDAs…" />);

    // getByRole ignora lo que está bajo aria-hidden: solo existe el anuncio propio.
    expect(screen.getByRole('status')).toHaveTextContent('Cargando estado de CDAs…');
    expect(screen.getByText(/in progress/).closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('la región live nace vacía y el texto se inserta después (para que se anuncie)', () => {
    // Sin efectos (primer render): la región todavía no tiene texto.
    const html = renderToStaticMarkup(<Cargando texto="Cargando…" />);
    expect(html).toContain('<span role="status" class="sr-only"></span>');

    // Con efectos: ya lo tiene.
    render(<Cargando texto="Cargando…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando…');
  });
});
