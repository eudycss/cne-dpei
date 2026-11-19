import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PersonaDistribucionDias } from '@cne/shared-types';

import { NuevaDistribucionModal } from './NuevaDistribucionModal';
import { AgregarPersonaDistribucionModal } from './AgregarPersonaDistribucionModal';
import { EditarPersonaDistribucionModal } from './EditarPersonaDistribucionModal';
import {
  agregarPersonaDistribucion,
  crearDistribucion,
  editarPersonaDistribucion,
  getCandidatosDistribucion,
} from '../../lib/queries/distribucion-dias';

vi.mock('../../lib/queries/distribucion-dias', () => ({
  crearDistribucion: vi.fn(),
  agregarPersonaDistribucion: vi.fn(),
  editarPersonaDistribucion: vi.fn(),
  getCandidatosDistribucion: vi.fn(),
}));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));
vi.mock('./utils', async (original) => ({ ...(await original<typeof import('./utils')>()), hoyEcuador: () => '2026-11-18' }));

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const DIAS = ['2026-11-20', '2026-11-21', '2026-11-22'];
const SUG = { cantones: ['IBARRA'], encargados: ['Willy'] };

function envolver(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

describe('NuevaDistribucionModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('propone el próximo viernes a domingo y excluye de fábrica Supervisores y Archivo de Actas', async () => {
    mock(crearDistribucion).mockResolvedValue({ id: 'd1', total: 0, fechas: DIAS });
    const onCreada = vi.fn();
    envolver(<NuevaDistribucionModal anterior={null} onClose={vi.fn()} onCreada={onCreada} />);
    await userEvent.type(screen.getByLabelText('Nombre'), 'Fin de semana');
    await userEvent.type(screen.getByLabelText('Encargado del CPE'), 'Edison Mafla');
    await userEvent.click(screen.getByRole('button', { name: 'Crear y repartir' }));
    await waitFor(() => expect(crearDistribucion).toHaveBeenCalled());
    const body = mock(crearDistribucion).mock.calls[0][0];
    expect(body.fechas).toEqual(DIAS);
    expect([...body.excluirCargos].sort()).toEqual(['ASISTENTE_ARCHIVOS', 'SUPERVISOR']);
    expect(body).toMatchObject({ cantonCpe: 'IBARRA', encargadoCpe: 'Edison Mafla' });
    await waitFor(() => expect(onCreada).toHaveBeenCalled());
  });

  it('un día vacío no se descarta en silencio: avisa y no envía', async () => {
    envolver(<NuevaDistribucionModal anterior={null} onClose={vi.fn()} onCreada={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Nombre'), 'Fin de semana');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar día' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear y repartir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Complete o quite el día 4');
    expect(crearDistribucion).not.toHaveBeenCalled();
  });
});

describe('AgregarPersonaDistribucionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(getCandidatosDistribucion).mockResolvedValue([{ id: '22222222-2222-4222-8222-222222222222', nombre: 'SUPERVISOR UNO', cedula: '1003456785', cargo: 'Supervisores' }]);
  });

  it('agrega a alguien del personal registrado (aunque su cargo esté excluido)', async () => {
    mock(agregarPersonaDistribucion).mockResolvedValue({ nombres: 'SUPERVISOR UNO', fecha: DIAS[1] });
    const onClose = vi.fn();
    envolver(<AgregarPersonaDistribucionModal distribucionId="d1" fechas={DIAS} sugerencias={SUG} onClose={onClose} />);
    await userEvent.click(await screen.findByLabelText(/SUPERVISOR UNO/));
    expect(screen.getByRole('status')).toHaveTextContent('1 resultado(s)');
    await userEvent.selectOptions(screen.getByLabelText('Día'), DIAS[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(agregarPersonaDistribucion).toHaveBeenCalledWith('d1', { tipo: 'REGISTRADA', fecha: DIAS[1], operadorId: '22222222-2222-4222-8222-222222222222' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('persona externa: valida la cédula y muestra el 409 de cédula repetida', async () => {
    envolver(<AgregarPersonaDistribucionModal distribucionId="d1" fechas={DIAS} sugerencias={SUG} onClose={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Persona externa (no está en el sistema)'));
    await userEvent.type(screen.getByLabelText('Apellidos y nombres'), 'RUIZ ANA');
    await userEvent.type(screen.getByLabelText('Cédula'), '1003456789');
    await userEvent.selectOptions(screen.getByLabelText('Sexo'), 'F');
    await userEvent.type(screen.getByLabelText('Cargo'), 'Apoyo');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/[Cc]édula/);
    expect(agregarPersonaDistribucion).not.toHaveBeenCalled();

    mock(agregarPersonaDistribucion).mockRejectedValue({ response: { data: { message: 'Esa cédula ya está en esta distribución' } } });
    await userEvent.clear(screen.getByLabelText('Cédula'));
    await userEvent.type(screen.getByLabelText('Cédula'), '1003456785');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText('Esa cédula ya está en esta distribución')).toBeInTheDocument();
    expect(mock(agregarPersonaDistribucion).mock.calls[0][1]).toMatchObject({ tipo: 'EXTERNA', cedula: '1003456785', sexo: 'F' });
  });
});

describe('EditarPersonaDistribucionModal', () => {
  const persona: PersonaDistribucionDias = {
    id: 'p1',
    fecha: DIAS[0],
    operadorId: 'o1',
    nombres: 'PÉREZ JUAN',
    cedula: '1003456785',
    telefono: null,
    sexo: 'M',
    cargo: 'Operadores CDA',
    canton: 'OTAVALO',
    encargado: null,
  };

  beforeEach(() => vi.clearAllMocks());

  it('envía solo día, cantón y encargado', async () => {
    mock(editarPersonaDistribucion).mockResolvedValue(persona);
    envolver(<EditarPersonaDistribucionModal distribucionId="d1" persona={persona} fechas={DIAS} sugerencias={SUG} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Día'), DIAS[2]);
    await userEvent.type(screen.getByLabelText('Encargado'), 'Willy');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editarPersonaDistribucion).toHaveBeenCalledWith('d1', 'p1', { fecha: DIAS[2], canton: 'OTAVALO', encargado: 'Willy' }));
  });

  it('muestra el error de la API como alerta', async () => {
    mock(editarPersonaDistribucion).mockRejectedValue({ response: { data: { message: 'Ese día no es parte de la distribución' } } });
    envolver(<EditarPersonaDistribucionModal distribucionId="d1" persona={persona} fechas={DIAS} sugerencias={SUG} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese día no es parte de la distribución');
  });
});
