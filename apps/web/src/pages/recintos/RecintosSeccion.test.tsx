import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { RoleName } from '@cne/shared-types';

import { RecintosSeccion } from './RecintosSeccion';

let roles: RoleName[] = ['ADMINISTRADOR'];
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { roles } }),
}));
vi.mock('./RecintosPage', () => ({ RecintosPage: () => <div>listado de recintos</div> }));
vi.mock('../enlaces/EnlacesPage', () => ({ EnlacesPage: () => <div>estado de enlaces</div> }));
vi.mock('./TiemposViajePage', () => ({ TiemposViajePage: () => <div>tabla de tiempos</div> }));

function UbicacionActual() {
  const { search } = useLocation();
  return <output aria-label="ubicación">{search}</output>;
}

function renderSeccion(ruta = '/recintos') {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route
          path="/recintos"
          element={
            <>
              <RecintosSeccion />
              <UbicacionActual />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const pestana = (nombre: string) => screen.getByRole('tab', { name: nombre });
const ubicacion = () => screen.getByLabelText('ubicación').textContent;

describe('RecintosSeccion', () => {
  beforeEach(() => {
    roles = ['ADMINISTRADOR'];
  });

  it('el administrador ve las pestañas y por defecto el listado de recintos', () => {
    renderSeccion();
    expect(screen.getByRole('heading', { level: 2, name: 'Recintos Electorales' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Recintos, enlaces y tiempos de viaje' })).toBeInTheDocument();
    expect(pestana('Recintos')).toHaveAttribute('aria-selected', 'true');
    expect(pestana('Enlaces')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel', { name: 'Recintos' })).toHaveTextContent('listado de recintos');
  });

  it('?tab=enlaces abre directo la pestaña Enlaces', () => {
    renderSeccion('/recintos?tab=enlaces');
    expect(pestana('Enlaces')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Enlaces' })).toHaveTextContent('estado de enlaces');
    expect(screen.queryByText('listado de recintos')).not.toBeInTheDocument();
  });

  it('?tab=tiempos abre directo la pestaña Tiempos de viaje', () => {
    renderSeccion('/recintos?tab=tiempos');
    expect(pestana('Tiempos de viaje')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Tiempos de viaje' })).toHaveTextContent('tabla de tiempos');
  });

  it('una pestaña desconocida en la URL abre el listado de recintos', () => {
    renderSeccion('/recintos?tab=otra');
    expect(pestana('Recintos')).toHaveAttribute('aria-selected', 'true');
  });

  it('al hacer clic cambia de pestaña y lo refleja en la URL', async () => {
    renderSeccion();
    await userEvent.click(pestana('Enlaces'));
    expect(screen.getByText('estado de enlaces')).toBeInTheDocument();
    expect(ubicacion()).toBe('?tab=enlaces');

    await userEvent.click(pestana('Recintos'));
    expect(screen.getByText('listado de recintos')).toBeInTheDocument();
    expect(ubicacion()).toBe('');
  });

  it('solo la pestaña activa entra en el orden de tabulación', () => {
    renderSeccion();
    expect(pestana('Recintos')).toHaveAttribute('tabIndex', '0');
    expect(pestana('Enlaces')).toHaveAttribute('tabIndex', '-1');
    expect(pestana('Recintos')).toHaveAttribute('aria-controls', 'panel-recintos');
    expect(pestana('Enlaces')).not.toHaveAttribute('aria-controls');
  });

  it('las flechas, Inicio y Fin mueven el foco y activan la pestaña', async () => {
    renderSeccion();
    pestana('Recintos').focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(pestana('Enlaces')).toHaveFocus();
    expect(pestana('Enlaces')).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{ArrowRight}');
    expect(pestana('Tiempos de viaje')).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(pestana('Recintos')).toHaveFocus();

    await userEvent.keyboard('{ArrowLeft}');
    expect(pestana('Tiempos de viaje')).toHaveFocus();

    await userEvent.keyboard('{Home}');
    expect(pestana('Recintos')).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{End}');
    expect(pestana('Tiempos de viaje')).toHaveAttribute('aria-selected', 'true');
  });

  it.each<RoleName>(['TECNICO_SUPERVISOR', 'LECTOR'])(
    '%s no ve pestañas ni puede abrir Tiempos de viaje desde la URL',
    (rol) => {
      roles = [rol];
      renderSeccion('/recintos?tab=tiempos');
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
      expect(screen.queryByText('tabla de tiempos')).not.toBeInTheDocument();
      expect(screen.getByText('listado de recintos')).toBeInTheDocument();
      expect(screen.queryByText('estado de enlaces')).not.toBeInTheDocument();
    },
  );
});
