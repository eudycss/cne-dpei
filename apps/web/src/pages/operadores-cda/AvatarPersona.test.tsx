import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AvatarPersona } from './AvatarPersona';
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
});
