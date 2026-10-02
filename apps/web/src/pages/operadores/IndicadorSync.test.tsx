import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { IndicadorSync, haceCuanto } from './IndicadorSync';

describe('haceCuanto', () => {
  it('da un texto corto según el tiempo transcurrido', () => {
    expect(haceCuanto(0, 2_000)).toBe('justo ahora');
    expect(haceCuanto(0, 12_000)).toBe('hace 12 s');
    expect(haceCuanto(0, 125_000)).toBe('hace 2 min');
  });
});

describe('IndicadorSync', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('muestra hace cuánto se actualizó y avanza solo con el tiempo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    const actualizadoEn = Date.now();

    render(<IndicadorSync actualizadoEn={actualizadoEn} actualizando={false} error={false} />);
    expect(screen.getByText('Actualizado justo ahora')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByText('Actualizado hace 15 s')).toBeInTheDocument();
  });

  it('indica cuando está actualizando y cuando aún no hay datos', () => {
    const { rerender } = render(<IndicadorSync actualizadoEn={0} actualizando={false} error={false} />);
    expect(screen.getByText('Esperando datos…')).toBeInTheDocument();

    rerender(<IndicadorSync actualizadoEn={Date.now()} actualizando error={false} />);
    expect(screen.getByText('Actualizando…')).toBeInTheDocument();
  });

  it('el StatusMark refleja el estado y queda oculto al lector (su texto es en inglés)', () => {
    const { container, rerender } = render(
      <IndicadorSync actualizadoEn={Date.now()} actualizando error={false} />,
    );
    const indicador = container.querySelector('.sync-indicator')!;
    expect(indicador).toHaveAttribute('data-estado', 'running');
    expect(container.querySelector('.status-mark')?.closest('[aria-hidden="true"]')).not.toBeNull();

    rerender(<IndicadorSync actualizadoEn={Date.now()} actualizando={false} error={false} />);
    expect(indicador).toHaveAttribute('data-estado', 'done');

    rerender(<IndicadorSync actualizadoEn={Date.now()} actualizando={false} error />);
    expect(indicador).toHaveAttribute('data-estado', 'failed');
  });

  it('solo anuncia el error al lector de pantalla, no cada refresco', () => {
    const { rerender } = render(
      <IndicadorSync actualizadoEn={Date.now()} actualizando={false} error={false} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('');

    rerender(<IndicadorSync actualizadoEn={Date.now()} actualizando={false} error />);
    expect(screen.getByRole('status')).toHaveTextContent('No se pudo actualizar el estado de los CDAs');
    expect(screen.getByText('No se pudo actualizar')).toBeInTheDocument();
  });
});
