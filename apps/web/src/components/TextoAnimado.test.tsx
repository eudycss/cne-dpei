import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Imita a SlotText: un <span> por carácter.
vi.mock('slot-text/react', () => ({
  SlotText: ({ text }: { text: string }) => (
    <span data-testid="slot">
      {text.split('').map((c, i) => (
        <span key={i}>{c}</span>
      ))}
    </span>
  ),
}));

import { TextoAnimado } from './TextoAnimado';

describe('TextoAnimado', () => {
  it('expone el texto completo a lectores de pantalla y oculta las letras animadas', () => {
    render(<TextoAnimado text="En tránsito" />);

    const legible = screen.getByText('En tránsito');
    expect(legible).toHaveClass('sr-only');
    expect(screen.getByTestId('slot').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('renderiza sin errores con movimiento reducido', () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    render(<TextoAnimado text="3" />);
    expect(screen.getByText('3', { selector: '.sr-only' })).toBeInTheDocument();

    window.matchMedia = original;
  });
});
