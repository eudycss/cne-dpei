import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { FiltroEstado, type FiltroEstadoValor } from './FiltroEstado';

function Controlado({ onChange }: { onChange?: (v: FiltroEstadoValor) => void }) {
  const [valor, setValor] = useState<FiltroEstadoValor>('TODOS');
  return (
    <FiltroEstado
      valor={valor}
      onChange={(v) => {
        setValor(v);
        onChange?.(v);
      }}
      conteo={{ EN_TRANSITO: 2, RETORNADO: 1 }}
      total={3}
    />
  );
}

describe('FiltroEstado', () => {
  it('es un grupo de radios con la opción activa marcada y sus cantidades', () => {
    render(<Controlado />);

    expect(screen.getByRole('radiogroup', { name: 'Filtrar CDAs por estado' })).toBeInTheDocument();
    const todos = screen.getByRole('radio', { name: /Todos/ });
    expect(todos).toHaveAttribute('aria-checked', 'true');
    expect(todos).toHaveTextContent('3');
    expect(screen.getByRole('radio', { name: /En tránsito/ })).toHaveTextContent('2');
  });

  it('cambia con clic', async () => {
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: /Llegó al DPEI/ }));

    expect(onChange).toHaveBeenLastCalledWith('RETORNADO');
    expect(screen.getByRole('radio', { name: /Llegó al DPEI/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('se activa con un click sin pointerdown (lectores de pantalla, Voice Control)', () => {
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);

    // fireEvent.click no genera pointerdown, igual que un click sintético de tecnología de asistencia.
    fireEvent.click(screen.getByRole('radio', { name: /En tránsito/ }));

    expect(onChange).toHaveBeenLastCalledWith('EN_TRANSITO');
    expect(screen.getByRole('radio', { name: /En tránsito/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('las flechas no dan la vuelta: en la primera opción, ← no cambia nada', async () => {
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);

    await userEvent.tab();
    await userEvent.keyboard('{ArrowLeft}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: /Todos/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('un solo Tab entra al grupo y las flechas, Inicio y Fin mueven la selección', async () => {
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);

    await userEvent.tab();
    expect(screen.getByRole('radio', { name: /Todos/ })).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('EN_DPI');
    expect(screen.getByRole('radio', { name: /En DPI/ })).toHaveFocus();

    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('RETORNADO');
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('TODOS');

    // Solo la opción activa queda en el orden de tabulación.
    const enTab = screen.getAllByRole('radio').filter((r) => r.getAttribute('tabindex') === '0');
    expect(enTab).toHaveLength(1);
  });
});
