import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DonaEvatics } from './DonaEvatics';

const totales = { total: 10, aprobados: 5, pendientes: 2, rechazados: 1, sinSubir: 2 };

describe('DonaEvatics', () => {
  it('describe el reparto en texto y lo lista con cifra y porcentaje', () => {
    render(<DonaEvatics totales={totales} />);
    expect(
      screen.getByRole('img', {
        name: 'Certificados por estado. Total 10. Aprobados: 5, En revisión: 2, Rechazados: 1, Sin subir: 2',
      }),
    ).toBeInTheDocument();
    const lista = screen.getByRole('list');
    expect(within(lista).getByText('5 · 50 %')).toBeInTheDocument();
    expect(within(lista).getAllByRole('listitem')).toHaveLength(4);
  });

  it('usa los colores de estado del tema y un arco por tramo', () => {
    const { container } = render(<DonaEvatics totales={totales} />);
    const arcos = container.querySelectorAll<SVGCircleElement>('.estad-dona-tramo');
    expect(arcos).toHaveLength(4);
    expect(arcos[0].style.stroke).toBe('var(--f-exito)');
    expect(arcos[3].style.stroke).toBe('var(--f-text-muted)');
  });

  it('sin personal no divide entre cero', () => {
    render(<DonaEvatics totales={{ total: 0, aprobados: 0, pendientes: 0, rechazados: 0, sinSubir: 0 }} />);
    expect(screen.getAllByText('0 · 0 %')).toHaveLength(4);
  });
});
