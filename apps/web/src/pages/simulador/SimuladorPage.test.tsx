import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NovedadDigitacion, PracticaDigitacion } from '@cne/shared-types';

import { SimuladorPage } from './SimuladorPage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const patchMock = api.patch as unknown as ReturnType<typeof vi.fn>;

const PRACTICA: PracticaDigitacion = {
  id: '11111111-1111-4111-8111-111111111111',
  nombre: 'Simulacro 1',
  filasPorActa: 12,
  votoMin: 0,
  votoMax: 350,
  metaActas: 200,
  plazoMinutos: 60,
  inicio: '2026-11-10T13:00:00.000Z',
  fin: '2026-11-10T23:00:00.000Z',
  pctDigitosDistintos: 10,
  intentosMax: 2,
  activa: true,
  cargos: ['DIGITADOR'],
  personas: [],
  alcance: 30,
  intentos: 4,
  creadoEn: '2026-11-05T12:00:00.000Z',
};

let novedades: NovedadDigitacion[] = [];

function renderPagina(ruta = '/simulador-digitacion') {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SimuladorPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SimuladorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    novedades = [];
    getMock.mockImplementation((url: string) => {
      if (url.endsWith('/practicas')) return Promise.resolve({ data: [PRACTICA] });
      if (url.endsWith('/novedades')) return Promise.resolve({ data: novedades });
      if (url.endsWith('/cargos')) return Promise.resolve({ data: [] });
      return Promise.reject(new Error(url));
    });
    patchMock.mockResolvedValue({ data: { ...PRACTICA, activa: false } });
  });

  it('lista las prácticas con ventana en hora de Ecuador, meta, alcance e intentos', async () => {
    renderPagina();
    expect(screen.getByRole('heading', { level: 2, name: 'Simulador de digitación' })).toBeInTheDocument();
    const tabla = await screen.findByRole('table', { name: 'Prácticas de digitación' });
    const fila = within(tabla).getAllByRole('row')[1];
    expect(fila).toHaveTextContent('Simulacro 1');
    expect(fila).toHaveTextContent('10/11/2026 08:00');
    expect(fila).toHaveTextContent('hasta 10/11/2026 18:00');
    expect(fila).toHaveTextContent('200 actas');
    expect(fila).toHaveTextContent('30 personas');
    expect(fila).toHaveTextContent('máx. 2 por persona');
    expect(fila).toHaveTextContent('Activa');
  });

  it('desactivar una práctica', async () => {
    const user = userEvent.setup();
    renderPagina();
    await user.click(await screen.findByRole('button', { name: 'Desactivar Simulacro 1' }));
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(`/simulador-digitacion/practicas/${PRACTICA.id}/activa`, { activa: false }),
    );
  });

  it('abre el formulario para crear y para editar', async () => {
    const user = userEvent.setup();
    renderPagina();
    await user.click(screen.getByRole('button', { name: '+ Nueva práctica' }));
    expect(screen.getByRole('dialog', { name: 'Nueva práctica' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(await screen.findByRole('button', { name: 'Editar Simulacro 1' }));
    expect(screen.getByRole('dialog', { name: 'Editar práctica' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre de la práctica')).toHaveValue('Simulacro 1');
  });

  it('sin prácticas: mensaje para crear la primera', async () => {
    getMock.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/practicas') ? [] : [] }));
    renderPagina();
    expect(await screen.findByText('Todavía no hay prácticas. Cree la primera.')).toBeInTheDocument();
  });

  it('novedades: renombrar con Enter devuelve el foco a "Editar"; Escape cancela', async () => {
    const user = userEvent.setup();
    novedades = [{ id: 'n1', nombre: 'Acta ilegible', activa: true, orden: 1 }];
    patchMock.mockImplementation((_u: string, b: { nombre?: string; activa?: boolean }) => {
      novedades = [{ ...novedades[0], ...b }];
      return Promise.resolve({ data: novedades[0] });
    });
    renderPagina('/simulador-digitacion?tab=novedades');
    await user.click(await screen.findByRole('button', { name: 'Editar Acta ilegible' }));
    const campo = screen.getByLabelText('Nombre de la novedad');
    await user.clear(campo);
    await user.type(campo, 'Acta sin firmas{Enter}');
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/simulador-digitacion/novedades/n1', { nombre: 'Acta sin firmas' }));
    const editar = await screen.findByRole('button', { name: 'Editar Acta sin firmas' });
    await waitFor(() => expect(editar).toHaveFocus());

    await user.click(editar);
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Nombre de la novedad')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar Acta sin firmas' })).toHaveFocus();
  });

  it('novedades: desactivar avisa el cambio', async () => {
    const user = userEvent.setup();
    const { sileo } = await import('sileo');
    novedades = [{ id: 'n1', nombre: 'Acta ilegible', activa: true, orden: 1 }];
    patchMock.mockResolvedValue({ data: { ...novedades[0], activa: false } });
    renderPagina('/simulador-digitacion?tab=novedades');
    await user.click(await screen.findByRole('button', { name: 'Desactivar Acta ilegible' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/simulador-digitacion/novedades/n1/activa', { activa: false }));
    expect(sileo.success).toHaveBeenCalledWith({ title: 'Novedad desactivada', description: 'Acta ilegible' });
  });

  it('novedades: agrega una y valida el nombre', async () => {
    const user = userEvent.setup();
    postMock.mockImplementation((_u: string, b: { nombre: string }) => {
      novedades = [{ id: 'n1', nombre: b.nombre, activa: true, orden: 1 }];
      return Promise.resolve({ data: novedades[0] });
    });
    renderPagina('/simulador-digitacion?tab=novedades');
    expect(await screen.findByText('Aún no hay novedades cargadas.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(screen.getByLabelText('Nueva novedad')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Nueva novedad')).toHaveFocus();
    expect(postMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Nueva novedad'), 'Acta ilegible');
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/simulador-digitacion/novedades', { nombre: 'Acta ilegible' }));
    expect(await screen.findByRole('table', { name: 'Novedades del SIER' })).toHaveTextContent('Acta ilegible');
  });
});
