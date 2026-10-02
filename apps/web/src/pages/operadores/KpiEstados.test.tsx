import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('slot-text/react', () => ({
  SlotText: ({ text }: { text: string }) => <>{text}</>,
}));

import { KpiEstados, porcentajeLlegada } from './KpiEstados';

describe('porcentajeLlegada', () => {
  it('calcula el % de CDAs que llegaron, redondeado', () => {
    expect(porcentajeLlegada({ RETORNADO: 1 }, 3)).toBe(33);
    expect(porcentajeLlegada({ RETORNADO: 4 }, 4)).toBe(100);
  });

  it('da 0 sin CDAs (sin dividir entre cero)', () => {
    expect(porcentajeLlegada({}, 0)).toBe(0);
  });
});

describe('KpiEstados', () => {
  it('muestra el número de CDAs por estado y el avance de llegada como medidor', () => {
    render(<KpiEstados conteo={{ EN_TRANSITO: 2, RETORNADO: 1 }} total={4} />);

    const medidor = screen.getByRole('meter', { name: 'CDAs que llegaron al DPEI (1 de 4)' });
    expect(medidor).toHaveAttribute('aria-valuenow', '25');
    expect(medidor).toHaveAttribute('aria-valuemin', '0');
    expect(medidor).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('1 de 4 CDAs')).toBeInTheDocument();

    const tarjetaTransito = screen.getByText('En tránsito').closest('.kpi-card')!;
    expect(tarjetaTransito.querySelector('.sr-only')).toHaveTextContent('2');
    const tarjetaDpi = screen.getByText('En DPI').closest('.kpi-card')!;
    expect(tarjetaDpi.querySelector('.sr-only')).toHaveTextContent('0');
  });

  it('el medidor no es interactivo (no entra en el orden de tabulación)', () => {
    render(<KpiEstados conteo={{}} total={0} />);
    expect(screen.getByRole('meter')).not.toHaveAttribute('tabindex');
  });
});
