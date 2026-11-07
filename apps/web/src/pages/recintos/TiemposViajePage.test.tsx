import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TiempoViajeRecinto, TiemposViajeRecintos } from '@cne/shared-types';

import { TiemposViajePage } from './TiemposViajePage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const putMock = api.put as unknown as ReturnType<typeof vi.fn>;

const recinto = (over: Partial<TiempoViajeRecinto>): TiempoViajeRecinto => ({
  id: 'r1',
  codigo: '1126',
  nombre: 'UE CHALTURA',
  canton: 'ANTONIO ANTE',
  tiempoMin: null,
  medidoMaxMin: null,
  viajesMedidos: 0,
  sugeridoMin: null,
  origenSugerido: null,
  ...over,
});

const DATOS: TiemposViajeRecintos = {
  margenMin: 30,
  recintos: [
    recinto({ id: 'r1', codigo: '1126', nombre: 'UE CHALTURA', medidoMaxMin: 42, viajesMedidos: 2, sugeridoMin: 75, origenSugerido: 'MEDIDO' }),
    recinto({ id: 'r2', codigo: '1298', nombre: 'UE APUELA', canton: 'COTACACHI', tiempoMin: 120, sugeridoMin: 90, origenSugerido: 'CANTON' }),
    recinto({ id: 'r3', codigo: '957', nombre: 'UE ATAHUALPA', canton: 'PIMAMPIRO' }),
  ],
};

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TiemposViajePage />
    </QueryClientProvider>,
  );
}

const casilla = (nombre: string) => screen.getByRole('spinbutton', { name: `Tiempo de viaje de ${nombre}, en minutos` });

describe('TiemposViajePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({ data: DATOS });
    putMock.mockResolvedValue({ data: { actualizados: 1 } });
  });

  it('muestra lo medido, el sugerido con su origen y cuántos CDA no tienen tiempo', async () => {
    montar();
    expect(await screen.findByText('1126 · UE CHALTURA')).toBeInTheDocument();
    expect(screen.getByText('42 min (2 viajes)')).toBeInTheDocument();
    expect(screen.getByText('(promedio del cantón)')).toBeInTheDocument();
    expect(screen.getByText('2 de 3 CDA sin tiempo de viaje.')).toBeInTheDocument();
    expect(casilla('1298 · UE APUELA')).toHaveValue(120);
    expect(screen.getByRole('button', { name: 'Guardar cambios (0)' })).toBeDisabled();
  });

  it('"Usar" copia el sugerido y "Guardar cambios" envía solo lo cambiado', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByRole('button', { name: 'Usar el sugerido (75 min) en 1126 · UE CHALTURA' }));
    expect(casilla('1126 · UE CHALTURA')).toHaveValue(75);
    expect(casilla('1126 · UE CHALTURA')).toHaveAccessibleDescription('Sin guardar');

    await user.click(screen.getByRole('button', { name: 'Guardar cambios (1)' }));
    expect(putMock).toHaveBeenCalledWith('/recintos/tiempos-viaje', { tiempos: [{ recintoId: 'r1', minutos: 75 }] });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
  });

  it('"Rellenar vacíos" propone el sugerido solo donde no hay tiempo; borrar la casilla quita el tiempo', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByRole('button', { name: 'Rellenar vacíos con el sugerido (1)' }));
    expect(casilla('1126 · UE CHALTURA')).toHaveValue(75);
    expect(casilla('1298 · UE APUELA')).toHaveValue(120);
    expect(casilla('957 · UE ATAHUALPA')).toHaveValue(null);

    await user.clear(casilla('1298 · UE APUELA'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios (2)' }));
    expect(putMock).toHaveBeenCalledWith('/recintos/tiempos-viaje', {
      tiempos: [
        { recintoId: 'r1', minutos: 75 },
        { recintoId: 'r2', minutos: null },
      ],
    });
  });

  it('un valor fuera de rango se marca y no deja guardar', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByText('957 · UE ATAHUALPA');
    await user.type(casilla('957 · UE ATAHUALPA'), '2');
    expect(casilla('957 · UE ATAHUALPA')).toHaveAttribute('aria-invalid', 'true');
    expect(casilla('957 · UE ATAHUALPA')).toHaveAccessibleDescription('Mínimo 5 minutos');
    expect(screen.getByRole('button', { name: 'Guardar cambios (1)' })).toBeDisabled();
  });

  it('"Descartar" vuelve a lo guardado', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByRole('button', { name: 'Rellenar vacíos con el sugerido (1)' }));
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(casilla('1126 · UE CHALTURA')).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'Guardar cambios (0)' })).toBeDisabled();
  });

  it('el buscador filtra por código, nombre o cantón', async () => {
    const user = userEvent.setup();
    montar();
    await user.type(await screen.findByLabelText('Buscar recinto'), 'cotacachi');
    expect(screen.getByText('1298 · UE APUELA')).toBeInTheDocument();
    expect(screen.queryByText('1126 · UE CHALTURA')).not.toBeInTheDocument();
  });

  it('si la API rechaza el guardado, muestra su mensaje', async () => {
    const user = userEvent.setup();
    putMock.mockRejectedValueOnce({ response: { data: { message: 'Solo los CDA activos tienen tiempo de viaje' } } });
    montar();
    await user.click(await screen.findByRole('button', { name: 'Usar el sugerido (75 min) en 1126 · UE CHALTURA' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios (1)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Solo los CDA activos tienen tiempo de viaje');
  });
});
