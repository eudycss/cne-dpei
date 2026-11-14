import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DonaEstados } from './DonaEstados';

const reparto = [
  { estado: 'EN_DPI' as const, cantidad: 2 },
  { estado: 'EN_TRANSITO' as const, cantidad: 1 },
  { estado: 'EN_RECINTO' as const, cantidad: 1 },
  { estado: 'EN_RETORNO' as const, cantidad: 0 },
  { estado: 'RETORNADO' as const, cantidad: 0 },
];

describe('DonaEstados', () => {
  it('describe el reparto en texto y lo lista con cifra y porcentaje', () => {
    render(<DonaEstados reparto={reparto} />);
    expect(
      screen.getByRole('img', { name: 'Parejas por estado. Total 4. En DPI: 2, En tránsito: 1, En el recinto: 1, En retorno: 0, Llegó al DPEI: 0' }),
    ).toBeInTheDocument();
    const lista = screen.getByRole('list');
    expect(within(lista).getByText('2 · 50 %')).toBeInTheDocument();
    expect(within(lista).getAllByRole('listitem')).toHaveLength(5);
  });

  it('con 0 parejas no divide entre cero', () => {
    render(<DonaEstados reparto={reparto.map((t) => ({ ...t, cantidad: 0 }))} />);
    expect(screen.getAllByText('0 · 0 %')).toHaveLength(5);
  });

  it('dibuja un arco por estado proporcional a su cantidad', () => {
    const { container } = render(<DonaEstados reparto={reparto} />);
    const tramos = container.querySelectorAll('.estad-dona-tramo');
    expect(tramos).toHaveLength(5);
    const circ = 2 * Math.PI * 40;
    // Con varios estados, cada arco deja un hueco de 2 para separar los colores.
    expect(Number(tramos[0].getAttribute('stroke-dasharray')!.split(' ')[0])).toBeCloseTo(circ / 2 - 2, 3);
    expect(Number(tramos[1].getAttribute('stroke-dashoffset'))).toBeCloseTo(-circ / 2, 3);
    expect(Number(tramos[2].getAttribute('stroke-dashoffset'))).toBeCloseTo(-(circ * 3) / 4, 3);
    expect(Number(tramos[3].getAttribute('stroke-dasharray')!.split(' ')[0])).toBe(0);
  });

  it('con un solo estado el anillo sale completo, sin hueco', () => {
    const solo = reparto.map((t) => ({ ...t, cantidad: t.estado === 'EN_RECINTO' ? 4 : 0 }));
    const { container } = render(<DonaEstados reparto={solo} />);
    const tramos = container.querySelectorAll('.estad-dona-tramo');
    const circ = 2 * Math.PI * 40;
    expect(Number(tramos[2].getAttribute('stroke-dasharray')!.split(' ')[0])).toBeCloseTo(circ, 3);
    expect(Number(tramos[0].getAttribute('stroke-dasharray')!.split(' ')[0])).toBe(0);
  });

  it('al cambiar los datos redibuja los arcos y la leyenda', () => {
    const { container, rerender } = render(<DonaEstados reparto={reparto} />);
    rerender(<DonaEstados reparto={reparto.map((t) => ({ ...t, cantidad: t.estado === 'RETORNADO' ? 4 : 0 }))} />);
    expect(screen.getByText('4 · 100 %')).toBeInTheDocument();
    expect(Number(container.querySelectorAll('.estad-dona-tramo')[4].getAttribute('stroke-dasharray')!.split(' ')[0])).toBeGreaterThan(200);
  });

  it('con 0 parejas el nombre accesible dice total 0', () => {
    render(<DonaEstados reparto={reparto.map((t) => ({ ...t, cantidad: 0 }))} />);
    expect(screen.getByRole('img', { name: /^Parejas por estado. Total 0./ })).toBeInTheDocument();
  });
});
