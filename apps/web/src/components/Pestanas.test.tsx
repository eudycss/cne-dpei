import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';

import { Pestanas } from './Pestanas';

const PESTANAS = [
  { id: 'uno', etiqueta: 'Uno' },
  { id: 'dos', etiqueta: 'Dos' },
  { id: 'tres', etiqueta: 'Tres' },
] as const;

function Ubicacion() {
  return <output data-testid="busqueda">{useLocation().search}</output>;
}

function renderPestanas(ruta = '/') {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Pestanas pestanas={PESTANAS} porDefecto="dos" etiqueta="Secciones">
        {(activa) => <p>Panel {activa}</p>}
      </Pestanas>
      <Ubicacion />
    </MemoryRouter>,
  );
}

describe('Pestanas', () => {
  it('abre la pestaña por defecto sin escribir ?tab= y solo monta el panel activo', () => {
    renderPestanas();
    expect(screen.getByRole('tablist', { name: 'Secciones' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Dos' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel dos');
    expect(screen.getByTestId('busqueda')).toHaveTextContent('');
  });

  it('un ?tab= inválido cae en la pestaña por defecto', () => {
    renderPestanas('/?tab=nada');
    expect(screen.getByRole('tab', { name: 'Dos' })).toHaveAttribute('aria-selected', 'true');
  });

  it('flechas (con vuelta), Home y End mueven el foco y la selección; volver a la de defecto limpia ?tab=', async () => {
    renderPestanas('/?tab=uno');
    screen.getByRole('tab', { name: 'Uno' }).focus();

    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Tres' })).toHaveFocus();
    expect(screen.getByTestId('busqueda')).toHaveTextContent('?tab=tres');

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Uno' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel tres');

    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Uno' })).toHaveFocus();

    await userEvent.click(screen.getByRole('tab', { name: 'Dos' }));
    expect(screen.getByTestId('busqueda')).toHaveTextContent('');
    // Solo la pestaña activa entra en el orden de tabulación.
    expect(screen.getByRole('tab', { name: 'Dos' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Uno' })).toHaveAttribute('tabindex', '-1');
  });
});
