import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CoordenadaRecinto, CoordenadasRecintos } from '@cne/shared-types';

import { CoordenadasPage } from './CoordenadasPage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

const recinto = (over: Partial<CoordenadaRecinto>): CoordenadaRecinto => ({
  id: 'r1',
  codigo: '1298',
  nombre: 'UE GARCÍA MORENO',
  canton: 'COTACACHI',
  latActual: 0.227472,
  lngActual: -78.632139,
  marcas: 9,
  marcasLejanas: 0,
  medianaMetros: 626,
  latPropuesta: 0.231491,
  lngPropuesta: -78.628385,
  desfaseMetros: 610,
  sospechosa: true,
  ...over,
});

const DATOS: CoordenadasRecintos = {
  umbralMetros: 150,
  minMarcas: 3,
  recintos: [
    recinto({}),
    recinto({ id: 'r2', codigo: '957', nombre: 'UE ATAHUALPA', canton: 'PIMAMPIRO', marcas: 2, medianaMetros: 400, latPropuesta: null, lngPropuesta: null, desfaseMetros: null, sospechosa: false }),
    recinto({ id: 'r3', codigo: '1126', nombre: 'UE CHALTURA', canton: 'ANTONIO ANTE', medianaMetros: 40, desfaseMetros: 35, sospechosa: false }),
  ],
};

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CoordenadasPage />
    </QueryClientProvider>,
  );
}

describe('CoordenadasPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({ data: DATOS });
  });

  it('por defecto muestra solo los recintos desplazados, con la coordenada guardada y la propuesta', async () => {
    montar();
    expect(await screen.findByText(/1298 · UE GARCÍA MORENO/)).toBeInTheDocument();
    expect(screen.queryByText(/UE ATAHUALPA/)).not.toBeInTheDocument();
    expect(screen.queryByText(/UE CHALTURA/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 de 3 recintos con marcaciones tienen la coordenada desplazada');
    expect(screen.getByText('0.227472, -78.632139')).toBeInTheDocument();
    expect(screen.getByText('0.231491, -78.628385')).toBeInTheDocument();
    expect(screen.getByText('610 m')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/recintos/coordenadas', { params: { umbral: 150 } });
  });

  it('al desmarcar "Solo desplazadas" muestra todos, y con pocas marcaciones no propone coordenada', async () => {
    montar();
    await screen.findByText(/1298 · UE GARCÍA MORENO/);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Solo desplazadas' }));
    expect(screen.getByText(/UE ATAHUALPA/)).toBeInTheDocument();
    expect(screen.getByText('Pocas marcaciones')).toBeInTheDocument();
    expect(screen.getByText(/UE CHALTURA/)).toBeInTheDocument();
  });

  it('el buscador filtra sin importar tildes', async () => {
    montar();
    await screen.findByText(/1298 · UE GARCÍA MORENO/);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Solo desplazadas' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar recinto' }), 'garcia');
    expect(screen.getByText(/UE GARCÍA MORENO/)).toBeInTheDocument();
    expect(screen.queryByText(/UE CHALTURA/)).not.toBeInTheDocument();
  });

  it('cambiar el umbral vuelve a consultar con el valor nuevo', async () => {
    montar();
    await screen.findByText(/1298 · UE GARCÍA MORENO/);
    const umbral = screen.getByLabelText('Umbral (m)');
    await userEvent.clear(umbral);
    await userEvent.type(umbral, '300');
    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith('/recintos/coordenadas', { params: { umbral: 300 } }));
  });

  it('los enlaces de mapa tienen nombre accesible', async () => {
    montar();
    expect(await screen.findByRole('link', { name: /^0\.231491, -78\.628385, coordenada propuesta de 1298 · UE GARCÍA MORENO/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps?q=0.231491,-78.628385',
    );
  });

  it('un umbral fuera de rango o con decimales avisa y no dispara otra consulta', async () => {
    montar();
    await screen.findByText(/1298 · UE GARCÍA MORENO/);
    const llamadas = getMock.mock.calls.length;
    const umbral = screen.getByLabelText('Umbral (m)');
    await userEvent.clear(umbral);
    await userEvent.type(umbral, '5');
    expect(umbral).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Entero entre 10 y 5000/)).toBeInTheDocument();
    expect(getMock.mock.calls.length).toBe(llamadas);
    await userEvent.clear(umbral);
    await userEvent.type(umbral, '10.5');
    // "10" (a medio escribir) sí es válido y consulta; el decimal completo se avisa y no se consulta.
    expect(umbral).toHaveAttribute('aria-invalid', 'true');
    expect(getMock).toHaveBeenLastCalledWith('/recintos/coordenadas', { params: { umbral: 10 } });
  });

  it('un recinto con solo marcaciones lejanas se ve desplazado y sin propuesta', async () => {
    getMock.mockResolvedValue({
      data: {
        ...DATOS,
        recintos: [recinto({ id: 'r9', codigo: '77', nombre: 'UE LEJOS', marcas: 0, marcasLejanas: 4, medianaMetros: 9100, latPropuesta: null, lngPropuesta: null, desfaseMetros: null })],
      },
    });
    montar();
    expect(await screen.findByText(/77 · UE LEJOS/)).toBeInTheDocument();
    expect(screen.getByText('(desplazada)')).toBeInTheDocument();
    expect(screen.getByText('Pocas marcaciones')).toBeInTheDocument();
  });

  it('si la consulta falla muestra el error', async () => {
    getMock.mockRejectedValue(new Error('boom'));
    montar();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las coordenadas');
  });
});
