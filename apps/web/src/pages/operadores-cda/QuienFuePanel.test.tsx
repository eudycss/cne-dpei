import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BusquedaAsignacionesCda } from '@cne/shared-types';

import { QuienFuePanel } from './QuienFuePanel';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('./grupo', () => ({ useCargosCda: () => ({ textos: (g: string) => ({ titulo: g === 'OPERADOR' ? 'Operador CDA' : 'Asistente CDA' }) }) }));

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;

const resultado: BusquedaAsignacionesCda = {
  personas: [
    {
      id: 'p1',
      apellidosNombres: 'CACHIGUANGO MIRIAM',
      cedula: '1000000001',
      grupo: 'ASISTENTE',
      asignaciones: [
        { fecha: '2026-11-05', recinto: { codigo: '1133', nombre: 'UE Manuel J. Calle' }, como: 'ASISTENTE', pareja: 'MEDIAVILLA MARIA' },
        { fecha: '2026-11-01', recinto: null, como: 'ASISTENTE', pareja: 'PEREZ ANA' },
      ],
    },
    { id: 'p2', apellidosNombres: 'NUEVA PERSONA', cedula: '1000000002', grupo: 'OPERADOR', asignaciones: [] },
  ],
  recintos: [
    {
      id: 'r1',
      codigo: '971',
      nombre: 'UE Chaltura',
      noCdas: [{ codigo: '2001', nombre: 'Escuelita' }],
      asignaciones: [{ fecha: '2026-10-28', operador: 'PEREZ ANA', asistente: null, kit: 'KIT-971' }],
    },
  ],
  truncado: false,
};

function Ubicacion() {
  return <span data-testid="ubicacion">{useLocation().search}</span>;
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/operadores-cda?tab=quien-fue']}>
        <QuienFuePanel />
        <Ubicacion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('QuienFuePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockResolvedValue({ data: resultado });
  });

  it('con menos de 3 caracteres no busca', async () => {
    renderPanel();
    await userEvent.setup().type(screen.getByRole('textbox', { name: /Buscar persona o recinto/ }), 'ca');
    expect(await screen.findByText('Escriba al menos 3 caracteres.')).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('muestra a dónde fue cada persona y quiénes fueron a cada recinto', async () => {
    renderPanel();
    await userEvent.setup().type(screen.getByRole('textbox', { name: /Buscar persona o recinto/ }), 'cachi');

    expect(await screen.findByText('CACHIGUANGO MIRIAM')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/parejas-cda/historial/buscar?q=cachi');
    const persona = screen.getByText('CACHIGUANGO MIRIAM').closest('li')!;
    expect(persona).toHaveTextContent('UE Manuel J. Calle de asistente con MEDIAVILLA MARIA');
    expect(within(persona).getByText('Reserva')).toBeInTheDocument();
    expect(screen.getByText('NUEVA PERSONA').closest('li')).toHaveTextContent('Todavía no ha estado en ninguna pareja.');

    const recinto = screen.getByText('UE Chaltura').closest('li')!;
    expect(recinto).toHaveTextContent('CDA del NO CDA 2001 · Escuelita');
    expect(recinto).toHaveTextContent('PEREZ ANA (sin asistente) · kit KIT-971');
    expect(screen.getByRole('status')).toHaveTextContent('2 persona(s) · 1 recinto(s)');
  });

  it('tocar una fecha abre ese día en Parejas', async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: /Buscar persona o recinto/ }), 'cachi');

    await user.click(await screen.findByRole('button', { name: 'Abrir el 05/11/2026 en Parejas: 1133 · UE Manuel J. Calle' }));

    expect(screen.getByTestId('ubicacion')).toHaveTextContent('tab=parejas');
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('dia=2026-11-05');
  });

  it('sin coincidencias lo dice', async () => {
    apiGet.mockResolvedValue({ data: { personas: [], recintos: [], truncado: false } });
    renderPanel();
    await userEvent.setup().type(screen.getByRole('textbox', { name: /Buscar persona o recinto/ }), 'zzzz');
    expect(await screen.findByText('No hay personas ni recintos que coincidan con "zzzz".')).toBeInTheDocument();
  });

  it('si hay más resultados de los que se muestran, pide afinar la búsqueda', async () => {
    apiGet.mockResolvedValue({ data: { ...resultado, truncado: true } });
    renderPanel();
    await userEvent.setup().type(screen.getByRole('textbox', { name: /Buscar persona o recinto/ }), 'cachi');
    expect(await screen.findByText(/Hay más resultados: afine la búsqueda/)).toBeInTheDocument();
  });

  it('si la API falla, muestra su mensaje como alerta', async () => {
    apiGet.mockRejectedValue({ response: { data: { message: 'Escriba al menos 3 caracteres' } } });
    renderPanel();
    await userEvent.setup().type(screen.getByRole('textbox', { name: /Buscar persona o recinto/ }), 'cachi');
    expect(await screen.findByRole('alert')).toHaveTextContent('Escriba al menos 3 caracteres');
  });
});
