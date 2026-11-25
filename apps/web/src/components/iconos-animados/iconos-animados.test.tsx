import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Controles falsos de motion para ver qué animación pide cada icono.
const start = vi.fn();
let reducido = false;
vi.mock('motion/react', async (original) => {
  const real = await original<typeof import('motion/react')>();
  return {
    ...real,
    useReducedMotion: () => reducido,
    useAnimation: () => ({ start, stop: vi.fn(), set: vi.fn(), subscribe: () => () => {}, mount: () => () => {} }),
  };
});

import { BellRingIcon, FileSpreadsheetIcon, PrinterIcon, RotateCcwIcon, RotateCwIcon, useIconoAnimado } from '.';

function BotonDePrueba({ Icono }: { Icono: typeof BellRingIcon }) {
  const icono = useIconoAnimado();
  return (
    <button type="button" {...icono.disparadores}>
      <Icono ref={icono.ref} size={16} aria-hidden="true" data-testid="icono" />
      Acción
    </button>
  );
}

const ICONOS = [
  ['campana', BellRingIcon],
  ['Excel', FileSpreadsheetIcon],
  ['impresora', PrinterIcon],
  ['girar izquierda', RotateCcwIcon],
  ['girar derecha', RotateCwIcon],
] as const;

describe('iconos animados', () => {
  beforeEach(() => {
    start.mockClear();
    reducido = false;
  });

  it.each(ICONOS)('el icono de %s queda oculto para lectores de pantalla y el botón conserva su nombre', (_n, Icono) => {
    render(<BotonDePrueba Icono={Icono as typeof BellRingIcon} />);
    expect(screen.getByTestId('icono')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Acción' })).toBeInTheDocument();
  });

  it.each(ICONOS)('el icono de %s se anima al pasar el mouse y al llegar con el teclado', async (_n, Icono) => {
    const user = userEvent.setup();
    render(<BotonDePrueba Icono={Icono as typeof BellRingIcon} />);
    const boton = screen.getByRole('button', { name: 'Acción' });

    await user.hover(boton);
    expect(start).toHaveBeenLastCalledWith('animate');
    await user.unhover(boton);
    expect(start).toHaveBeenLastCalledWith('normal');

    start.mockClear();
    await user.tab();
    expect(boton).toHaveFocus();
    expect(start).toHaveBeenLastCalledWith('animate');
  });

  it('al hacer clic no se vuelve a animar por el foco (solo cuenta el foco de teclado)', async () => {
    const user = userEvent.setup();
    render(<BotonDePrueba Icono={BellRingIcon} />);
    const boton = screen.getByRole('button', { name: 'Acción' });
    const matches = vi.spyOn(boton, 'matches').mockReturnValue(false);

    await user.click(boton);
    // Una sola vez: la del hover del clic, no otra por el foco.
    expect(start.mock.calls.filter(([v]) => v === 'animate')).toHaveLength(1);
    matches.mockRestore();
  });

  it.each(ICONOS)('con «reducir movimiento» el icono de %s no se mueve', async (_n, Icono) => {
    reducido = true;
    const user = userEvent.setup();
    render(<BotonDePrueba Icono={Icono as typeof BellRingIcon} />);

    await user.hover(screen.getByRole('button', { name: 'Acción' }));
    await user.tab();
    expect(start).not.toHaveBeenCalledWith('animate');
  });
});
