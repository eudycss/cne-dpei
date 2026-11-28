import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReporteLlegadaDpei } from '@cne/shared-types';

import { registroLlegadaTexto as registroTexto } from '@cne/shared-validation';
import { LlegadaDpeiPage } from './LlegadaDpeiPage';
import { api } from '../../lib/api';
import { duracionTexto, fechaCorta, horaConDia } from '../../lib/queries/llegada-dpei';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));
const guardarArchivo = vi.fn();
vi.mock('../../lib/queries/custodia', () => ({ guardarArchivo: (...a: unknown[]) => guardarArchivo(...a) }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

const REPORTE: ReporteLlegadaDpei = {
  evento: 'Elecciones 2027',
  fecha: '2026-11-29',
  resumen: {
    total: 2,
    llegaron: 1,
    faltan: 1,
    primeraLlegadaEn: '2026-11-30T07:10:00Z',
    ultimaLlegadaEn: '2026-11-30T07:10:00Z',
    duracionPromedioMin: 340,
  },
  cdas: [
    {
      codigoRecinto: '1487',
      nombreRecinto: 'UE Apuela',
      cantonNombre: 'COTACACHI',
      operadores: ['Mora Luis'],
      kits: ['KIT-2'],
      parejas: 2,
      parejasLlegadas: 1,
      salidaRecintoEn: '2026-11-30T02:00:00Z',
      llegadaDpiEn: null,
      duracionMin: null,
      manual: false,
      porKit: false,
    },
    {
      codigoRecinto: '971',
      nombreRecinto: 'UE Chaltura',
      cantonNombre: 'ANTONIO ANTE',
      operadores: ['Perez Ana'],
      kits: ['KIT-1'],
      parejas: 1,
      parejasLlegadas: 1,
      salidaRecintoEn: '2026-11-30T01:30:00Z',
      llegadaDpiEn: '2026-11-30T07:10:00Z',
      duracionMin: 340,
      manual: true,
      porKit: false,
    },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LlegadaDpeiPage />
    </QueryClientProvider>,
  );
}

describe('LlegadaDpeiPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockImplementation((url: string) =>
      Promise.resolve({ data: url.endsWith('.xlsx') || url.endsWith('.pdf') ? new Blob(['x']) : REPORTE }),
    );
  });

  it('muestra el resumen y una fila por CDA: el que falta primero, con horas que cruzan la medianoche', async () => {
    renderPage();
    const tabla = await screen.findByRole('table');
    const filas = within(tabla).getAllByRole('row').slice(1);
    expect(within(filas[0]).getByRole('rowheader')).toHaveTextContent('UE Apuela');
    expect(filas[0]).toHaveTextContent('1 de 2');
    expect(filas[0]).toHaveTextContent('✗ Falta');
    expect(within(filas[1]).getByRole('rowheader')).toHaveTextContent('UE Chaltura');
    expect(filas[1]).toHaveTextContent('✓ 30/11 02:10');
    expect(filas[1]).toHaveTextContent('5 h 40 min');
    expect(filas[1]).toHaveTextContent('Manual (administrador)');
    const resumen = screen.getByRole('group', { name: 'Resumen de llegadas' });
    expect(resumen).toHaveTextContent('Llegaron a la DPEI1de 2 CDA');
    expect(screen.getByText(/Jornada del 29\/11\/2026/)).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/tracking/reporte-llegada-dpei', { params: undefined });
  });

  it('al elegir otra jornada la pide a la API', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Jornada'), { target: { value: '2026-11-15' } });
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith('/tracking/reporte-llegada-dpei', { params: { fecha: '2026-11-15' } }),
    );
    // "Jornada actual" vuelve a la de hoy (sin fecha).
    getMock.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Jornada actual' }));
    expect(screen.getByLabelText('Jornada')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Jornada actual' })).toBeDisabled();
  });

  it('una jornada que todavía no empieza: muestra el mensaje de la API', async () => {
    getMock.mockRejectedValue({ response: { status: 400, data: { message: 'La jornada elegida todavía no empieza' } } });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('La jornada elegida todavía no empieza');
  });

  it('si la API falla lo avisa', async () => {
    getMock.mockRejectedValue(new Error('x'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el reporte');
  });

  it('evento sin CDA con kit: lo dice en vez de una tabla vacía', async () => {
    getMock.mockResolvedValue({ data: { ...REPORTE, cdas: [] } });
    renderPage();
    expect(await screen.findByText('No hay CDA con kit en este evento.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('descarga Excel y PDF con el nombre de la jornada', async () => {
    renderPage();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), 'llegada_dpei_cdas_2026-11-29.pdf'));
    expect(getMock).toHaveBeenCalledWith('/tracking/reporte-llegada-dpei.pdf', { params: undefined, responseType: 'blob' });
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    await waitFor(() => expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), 'llegada_dpei_cdas_2026-11-29.xlsx'));
  });

  it('sin evento activo lo dice y no deja descargar', async () => {
    getMock.mockResolvedValue({ data: null });
    renderPage();
    expect(await screen.findByText('No hay un evento electoral activo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar PDF' })).toBeDisabled();
  });
});

describe('formato de horas', () => {
  it('hora con el día en Ecuador y duración', () => {
    expect(horaConDia('2026-11-30T02:00:00Z')).toBe('29/11 21:00');
    expect(horaConDia(null)).toBe('—');
    expect(duracionTexto(95)).toBe('1 h 35 min');
    expect(duracionTexto(null)).toBe('—');
    expect(fechaCorta('2026-11-29')).toBe('29/11/2026');
  });

  it('cómo se registró la llegada', () => {
    const c = REPORTE.cdas[1];
    expect(registroTexto({ ...c, manual: false })).toBe('App');
    expect(registroTexto({ ...c, manual: false, porKit: true })).toBe('Por kit');
    expect(registroTexto({ ...c, porKit: true })).toBe('Manual (administrador), Por kit');
    expect(registroTexto({ ...c, parejasLlegadas: 0 })).toBe('—');
  });
});
