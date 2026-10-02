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

  it('al enfocar con teclado muestra el motivo en un tooltip', async () => {
    render(
      <BotonConMotivo onClick={() => {}} motivo="Aún no se subió el acta de escrutinio">
        Ver acta
      </BotonConMotivo>,
    );

    await userEvent.tab();

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Aún no se subió el acta de escrutinio');
    expect(screen.getByRole('button', { name: 'Ver acta' })).toHaveAttribute(
      'aria-describedby',
      tooltip.id,
    );
  });

  it('sin motivo no envuelve el botón en un tooltip', () => {
    const { container } = render(<BotonConMotivo onClick={() => {}}>Ver foto</BotonConMotivo>);
    expect(container.querySelector('.warm-tooltip__trigger')).toBeNull();
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
