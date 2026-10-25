import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OperadoresCdaPage } from './OperadoresCdaPage';
import { api } from '../../lib/api';
import { cargoCorto, hoyEcuador, horaEcuador, partirNombre } from './utils';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { roles: ['ADMINISTRADOR'] } }) }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

function renderPagina(ruta = '/operadores-cda') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <OperadoresCdaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OperadoresCdaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockImplementation((url: string) =>
      Promise.resolve({ data: url.startsWith('/operadores-cda/asistencia') ? { fecha: '2026-10-22', esHoy: true, filas: [] } : [] }),
    );
  });

  it('se llama CDAs y abre en Operadores CDA > Asistencia', async () => {
    renderPagina();
    expect(screen.getByRole('heading', { name: 'CDAs' })).toBeInTheDocument();
    const cargo = screen.getByRole('combobox', { name: 'Cargo' });
    expect(cargo).toHaveDisplayValue('Operadores CDA');
    expect(within(cargo).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Operadores CDA',
      'Asistentes CDA',
      'Digitadores',
      'Asistentes de Archivos',
      'Asistentes de firmas',
      'Receptores de actas',
      'Supervisores',
      'Operadores de escáner CPE',
    ]);
    expect(screen.getByRole('tab', { name: 'Asistencia' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByText(/Impórtelos desde la pestaña Listado/);
    expect(getMock).toHaveBeenCalledWith(expect.stringMatching(/^\/operadores-cda\/asistencia\?fecha=.*&grupo=OPERADOR$/));
  });

  it('Asistentes CDA tiene las mismas secciones y pide los datos de su grupo', async () => {
    renderPagina();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cargo' }), 'Asistentes CDA');
    expect(screen.getByRole('tablist', { name: 'Secciones de Asistentes CDA' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Asistencia' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Aún no hay asistentes. Impórtelos desde la pestaña Listado.')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(expect.stringMatching(/&grupo=ASISTENTE$/));

    await userEvent.click(screen.getByRole('tab', { name: 'Listado' }));
    expect(await screen.findByText('Aún no hay asistentes registrados.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar asistente' })).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/operadores-cda?grupo=ASISTENTE');
  });

  it('?grupo=asistentes&tab=atrasos abre directo los atrasos de los asistentes', async () => {
    renderPagina('/operadores-cda?grupo=asistentes&tab=atrasos');
    expect(screen.getByRole('combobox', { name: 'Cargo' })).toHaveDisplayValue('Asistentes CDA');
    expect(screen.getByRole('tab', { name: 'Atrasos' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/operadores-cda/asistencia/config?grupo=ASISTENTE'));
  });

  it('un cargo nuevo (Supervisores) usa las mismas secciones con sus propios datos y textos', async () => {
    renderPagina('/operadores-cda?tab=listado');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cargo' }), 'Supervisores');
    // Conserva la sección elegida.
    expect(screen.getByRole('tab', { name: 'Listado' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Aún no hay supervisores registrados.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar supervisor' })).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/operadores-cda?grupo=SUPERVISOR');
  });

  it('?grupo= desconocido abre Operadores CDA', async () => {
    renderPagina('/operadores-cda?grupo=TECNICO');
    expect(screen.getByRole('combobox', { name: 'Cargo' })).toHaveDisplayValue('Operadores CDA');
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringMatching(/&grupo=OPERADOR$/)));
  });

  it('abre en Asistencia y cambia de pestaña con clic o con las flechas', async () => {
    renderPagina();
    const asistencia = screen.getByRole('tab', { name: 'Asistencia' });
    expect(asistencia).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(/Impórtelos desde la pestaña Listado/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Listado' }));
    expect(screen.getByRole('tab', { name: 'Listado' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Aún no hay operadores registrados.')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Asistencia' })).toHaveFocus();
    const secciones = screen.getAllByRole('tabpanel');
    expect(secciones.at(-1)).toHaveAttribute('aria-labelledby', 'pestana-asistencia');
  });

  it('?tab=listado abre directo el listado, con su acción en el encabezado (antes del cargo)', async () => {
    renderPagina('/operadores-cda?tab=listado');
    expect(screen.getByRole('tab', { name: 'Listado' })).toHaveAttribute('aria-selected', 'true');
    const importar = await screen.findByRole('button', { name: 'Importar Excel' });
    expect(importar.closest('.ocda-encabezado')).not.toBeNull();
    // El orden de lectura y de tabulación sigue al visual: acciones y luego pestañas.
    expect(
      importar.compareDocumentPosition(screen.getByRole('combobox', { name: 'Cargo' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('al cambiar de pestaña cambian las acciones del encabezado', async () => {
    renderPagina('/operadores-cda?tab=listado');
    await screen.findByRole('button', { name: 'Importar Excel' });
    await userEvent.click(screen.getByRole('tab', { name: 'Asistencia' }));
    expect(screen.queryByRole('button', { name: 'Importar Excel' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Exportar' })).toBeInTheDocument();
  });
});

describe('utils de presentación', () => {
  it('abrevia el cargo como en Figma y conserva las siglas', () => {
    expect(cargoCorto('ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - OPERADORES CDA')).toBe('Asist. Adm. Electoral Provincial');
    expect(cargoCorto('OPERADOR CDA')).toBe('Operador CDA');
    expect(cargoCorto('  TÉCNICO   ELECTORAL ')).toBe('Técnico Electoral');
  });

  it('separa apellidos (dos primeras palabras) y nombres', () => {
    expect(partirNombre('CHÁVEZ MORA LUCÍA ESTEFANÍA')).toEqual({ apellidos: 'CHÁVEZ MORA', nombres: 'LUCÍA ESTEFANÍA' });
    expect(partirNombre('VEGA LUIS')).toEqual({ apellidos: 'VEGA LUIS', nombres: '' });
    expect(partirNombre('  RUIZ   MORA  JUAN  ')).toEqual({ apellidos: 'RUIZ MORA', nombres: 'JUAN' });
    expect(partirNombre('PÉREZ')).toEqual({ apellidos: 'PÉREZ', nombres: '' });
  });
});

describe('utils de fecha (hora de Ecuador)', () => {
  it('a las 19:30 de Ecuador sigue siendo el mismo día aunque en UTC ya sea mañana', () => {
    expect(hoyEcuador(new Date('2026-10-23T00:30:00Z'))).toBe('2026-10-22');
    expect(horaEcuador('2026-10-23T00:30:00Z')).toBe('19:30');
    // Medianoche de Ecuador: 00:05, nunca "24:05".
    expect(horaEcuador('2026-10-23T05:05:00Z')).toBe('00:05');
  });
});
