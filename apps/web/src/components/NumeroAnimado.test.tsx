import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumeroAnimado } from './NumeroAnimado';

const reducir = vi.hoisted(() => ({ valor: false }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => reducir.valor,
}));

describe('NumeroAnimado', () => {
  it('el primer render ya muestra el valor final', () => {
    render(<p data-testid="n"><NumeroAnimado valor={42} /></p>);
    expect(screen.getByTestId('n')).toHaveTextContent('42');
  });

  it('al cambiar el valor termina exactamente en el nuevo', async () => {
    reducir.valor = false;
    const { rerender } = render(<p data-testid="n"><NumeroAnimado valor={10} duracion={0.05} /></p>);
    rerender(<p data-testid="n"><NumeroAnimado valor={30} duracion={0.05} /></p>);
    await waitFor(() => expect(screen.getByTestId('n')).toHaveTextContent('30'));
  });

  it('con "reducir movimiento" salta directo al valor', () => {
    reducir.valor = true;
    const { rerender } = render(<p data-testid="n"><NumeroAnimado valor={10} /></p>);
    rerender(<p data-testid="n"><NumeroAnimado valor={99} /></p>);
    expect(screen.getByTestId('n')).toHaveTextContent('99');
    reducir.valor = false;
  });
});
