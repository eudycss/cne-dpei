import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AvatarPersona, ConFoto } from './AvatarPersona';
import { getFotoOperadorCda, getIdsConFoto } from '../../lib/queries/operadores-cda';

vi.mock('../../lib/queries/operadores-cda', () => ({ getIdsConFoto: vi.fn(), getFotoOperadorCda: vi.fn() }));
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

function envolver(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

describe('AvatarPersona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:foto');
    URL.revokeObjectURL = vi.fn();
    mock(getIdsConFoto).mockResolvedValue(['o1']);
    mock(getFotoOperadorCda).mockResolvedValue(new Blob(['jpg'], { type: 'image/jpeg' }));
  });

  it('sin foto: iniciales y no pide nada a la API', async () => {
    envolver(<AvatarPersona persona={{ operadorId: 'o2', nombre: 'RUIZ ANA' }} />);
    await waitFor(() => expect(getIdsConFoto).toHaveBeenCalled());
    expect(screen.getByText('RA')).toBeInTheDocument();
    expect(getFotoOperadorCda).not.toHaveBeenCalled();
  });

  it('persona externa: ni consulta quién tiene foto', () => {
    envolver(<AvatarPersona persona={{ operadorId: null, nombre: 'EXTERNA UNO' }} />);
    expect(getIdsConFoto).not.toHaveBeenCalled();
    expect(getFotoOperadorCda).not.toHaveBeenCalled();
  });

  it('con foto: se ve y se amplía; el foco vuelve a la miniatura al cerrar', async () => {
    envolver(<AvatarPersona persona={{ operadorId: 'o1', nombre: 'PÉREZ JUAN', cedula: '1003456785' }} />);
    const boton = await screen.findByRole('button', { name: 'Ver foto ampliada: PÉREZ JUAN' });
    await userEvent.click(boton);
    expect(screen.getByRole('img', { name: 'Foto de PÉREZ JUAN' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(boton).toHaveFocus();
  });

  it('en listas de selección (ampliable=false) la foto no es un botón', async () => {
    const { container } = envolver(<AvatarPersona persona={{ operadorId: 'o1', nombre: 'PÉREZ JUAN', tieneFoto: true }} ampliable={false} />);
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // tieneFoto ya conocido: no hace falta la consulta de ids.
    expect(getIdsConFoto).not.toHaveBeenCalled();
  });

  it('ConFoto (tablas y listas): miniatura junto al nombre, sin botón para no duplicar el nombre de la fila', async () => {
    const { container } = envolver(
      <table>
        <tbody>
          <tr>
            <th scope="row">
              <ConFoto persona={{ operadorId: 'o1', nombre: 'PÉREZ JUAN' }}>PÉREZ JUAN</ConFoto>
            </th>
          </tr>
        </tbody>
      </table>,
    );
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(getFotoOperadorCda).toHaveBeenCalledWith('o1');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'PÉREZ JUAN' })).toBeInTheDocument();
  });

  it('ConFoto de una persona externa: iniciales, sin pedir nada', () => {
    envolver(<ConFoto persona={{ operadorId: null, nombre: 'EXTERNA UNO' }}>EXTERNA UNO</ConFoto>);
    expect(screen.getByText('EU')).toBeInTheDocument();
    expect(getIdsConFoto).not.toHaveBeenCalled();
    expect(getFotoOperadorCda).not.toHaveBeenCalled();
  });
});
