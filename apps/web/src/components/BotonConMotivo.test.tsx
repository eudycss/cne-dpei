import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BotonConMotivo } from './BotonConMotivo';

describe('BotonConMotivo', () => {
  it('sin motivo funciona como un botón normal', async () => {
    const onClick = vi.fn();
    render(<BotonConMotivo onClick={onClick}>Ver foto</BotonConMotivo>);

    const boton = screen.getByRole('button', { name: 'Ver foto' });
    expect(boton).not.toHaveAttribute('aria-disabled');
    await userEvent.click(boton);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('con motivo queda inactivo, enfocable y anuncia el motivo', async () => {
    const onClick = vi.fn();
    render(
      <BotonConMotivo onClick={onClick} motivo="El operador aún no subió la foto del militar">
        Ver foto
      </BotonConMotivo>,
    );

    const boton = screen.getByRole('button', {
      name: 'Ver foto',
      description: 'El operador aún no subió la foto del militar',
    });
    expect(boton).toHaveAttribute('aria-disabled', 'true');
    expect(boton).not.toBeDisabled();

    await userEvent.tab();
    expect(boton).toHaveFocus();

    await userEvent.click(boton);
    await userEvent.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('respeta un aria-label propio', () => {
    render(
      <BotonConMotivo onClick={() => {}} ariaLabel="Ver acta de escrutinio — Colegio Otavalo">
        Ver acta
      </BotonConMotivo>,
    );
    expect(
      screen.getByRole('button', { name: 'Ver acta de escrutinio — Colegio Otavalo' }),
    ).toBeInTheDocument();
  });
});
