import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { RoleName } from '@cne/shared-types';

import { AuthProvider } from '../auth/AuthContext';
import { PasoFlujo } from './PasoFlujo';
import type { PasoId } from '../lib/flujo';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  tokenStore: { set: vi.fn(), clear: vi.fn() },
}));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;

const EVENTO = { id: 'ev1', nombre: 'Elecciones 2027', estado: 'ACTIVO' };

type Conteos = Partial<Record<'recintos' | 'usuarios' | 'militares' | 'asignaciones' | 'kits', number>> & {
  evento?: boolean;
};

function mockApi(c: Conteos) {
  apiGetMock.mockImplementation((url: string) => {
    const pag = (total = 0) => Promise.resolve({ data: { items: [], total, page: 1, pageSize: 1 } });
    if (url.startsWith('/recintos')) return pag(c.recintos);
    if (url.startsWith('/users')) return pag(c.usuarios);
    if (url.startsWith('/militares')) return pag(c.militares);
    if (url === '/eventos/active') return Promise.resolve({ data: c.evento ? EVENTO : '' });
    if (url.startsWith('/asignaciones')) return Promise.resolve({ data: new Array(c.asignaciones ?? 0).fill({}) });
    if (url.startsWith('/kits')) return pag(c.kits);
    return Promise.reject(new Error(`URL inesperada: ${url}`));
  });
}

const llamadasA = (prefijo: string) =>
  apiGetMock.mock.calls.filter(([u]) => (u as string).startsWith(prefijo)).length;

function renderPaso(paso: PasoId, roles: RoleName[] = ['ADMINISTRADOR']) {
  localStorage.setItem(
    'cne.user',
    JSON.stringify({ id: 'u1', email: 'u@cne.gob.ec', nombres: 'T', apellidos: 'U', debeCambiarPwd: false, roles }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <AuthProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PasoFlujo paso={paso} />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthProvider>,
  );
  return { ...utils, client };
}

const guia = () => screen.findByRole('region', { name: 'Guía de preparación' });

describe('PasoFlujo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('avisa al administrador qué pasos previos faltan, con enlace a cada uno, sin bloquear', async () => {
    mockApi({ recintos: 0, evento: false });
    renderPaso('kits');

    expect(await guia()).toHaveTextContent(
      'Antes de este paso falta completar: Recintos Electorales y Eventos Electorales. Puede seguir trabajando aquí',
    );
    expect(screen.getByRole('link', { name: 'Recintos Electorales' })).toHaveAttribute('href', '/recintos');
    expect(screen.getByRole('link', { name: 'Eventos Electorales' })).toHaveAttribute('href', '/eventos');
    expect(screen.queryByRole('link', { name: /Siguiente/ })).not.toBeInTheDocument();
  });

  it('a un rol de solo lectura le muestra un aviso neutro, sin invitar a completar', async () => {
    mockApi({ recintos: 0 });
    renderPaso('militares', ['LECTOR']);

    const region = await guia();
    expect(region).toHaveTextContent('Aún no hay datos de: Recintos Electorales.');
    expect(region).not.toHaveTextContent(/completar|trabajando/);
  });

  it('no usa una región viva: el aviso no se anuncia en cada carga de página', async () => {
    mockApi({ recintos: 0 });
    renderPaso('militares');
    await guia();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('con el paso listo ofrece ir al siguiente', async () => {
    mockApi({ recintos: 10, militares: 3 });
    renderPaso('militares');

    expect(await screen.findByRole('link', { name: 'Siguiente: Eventos Electorales' })).toHaveAttribute(
      'href',
      '/eventos',
    );
    expect(screen.queryByText(/Antes de este paso/)).not.toBeInTheDocument();
  });

  it('muestra aviso y botón a la vez si el paso tiene datos pero falta un requisito', async () => {
    mockApi({ recintos: 0, militares: 4 });
    renderPaso('militares');
    expect(await guia()).toHaveTextContent('Antes de este paso falta completar: Recintos Electorales');
    expect(screen.getByRole('link', { name: 'Siguiente: Eventos Electorales' })).toBeInTheDocument();
  });

  it('después de Kits el siguiente paso es Monitoreo', async () => {
    mockApi({ recintos: 10, evento: true, kits: 60 });
    renderPaso('kits');
    expect(await screen.findByRole('link', { name: 'Siguiente: Monitoreo' })).toHaveAttribute('href', '/operadores');
  });

  it('no muestra nada si no faltan requisitos y el paso aún no tiene datos', async () => {
    mockApi({});
    const { container } = renderPaso('recintos');
    await waitFor(() => expect(apiGetMock).toHaveBeenCalledWith('/eventos/active'));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('si el estado no se puede cargar, no muestra nada ni rompe la página', async () => {
    apiGetMock.mockRejectedValue(new Error('500'));
    const { container } = renderPaso('militares');
    await waitFor(() => expect(apiGetMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('se actualiza cuando la página invalida su listado tras un cambio', async () => {
    mockApi({ recintos: 0 });
    const { client } = renderPaso('militares');
    expect(await guia()).toHaveTextContent('Recintos Electorales');

    // La página de recintos ya tiene su listado en caché y lo invalida tras sincronizar.
    client.setQueryData(['recintos', { page: 1 }], { items: [], total: 0 });
    mockApi({ recintos: 5 });
    await act(() => client.invalidateQueries({ queryKey: ['recintos'] }));
    await waitFor(() => expect(screen.queryByText(/Antes de este paso/)).not.toBeInTheDocument());
  });

  it('junta en un solo refresco las invalidaciones de varios listados a la vez', async () => {
    mockApi({ recintos: 0 });
    const { client } = renderPaso('militares');
    await guia();
    for (const page of [1, 2, 3]) client.setQueryData(['recintos', { page }], { items: [], total: 0 });
    client.setQueryData(['users', { page: 1 }], { items: [], total: 0 });
    const antes = llamadasA('/recintos?pageSize=1');

    await act(async () => {
      void client.invalidateQueries({ queryKey: ['recintos'] }, { cancelRefetch: false });
      void client.invalidateQueries({ queryKey: ['users'] }, { cancelRefetch: false });
    });
    await waitFor(() => expect(llamadasA('/recintos?pageSize=1')).toBe(antes + 1));
  });

  it('ignora la invalidación de listados que no afectan la preparación', async () => {
    mockApi({ recintos: 0 });
    const { client } = renderPaso('militares');
    await guia();
    client.setQueryData(['incidencias'], []);
    const llamadas = apiGetMock.mock.calls.length;

    await act(() => client.invalidateQueries({ queryKey: ['incidencias'] }));
    expect(apiGetMock.mock.calls.length).toBe(llamadas);
  });

  it('al desmontarse deja de escuchar los cambios', async () => {
    mockApi({ recintos: 0 });
    const { client, unmount } = renderPaso('militares');
    await guia();
    client.setQueryData(['recintos', { page: 1 }], { items: [], total: 0 });
    unmount();
    const invalidar = vi.spyOn(client, 'invalidateQueries');

    await act(() => client.invalidateQueries({ queryKey: ['recintos'] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(invalidar).not.toHaveBeenCalledWith({ queryKey: ['preparacion'] }, expect.anything());
  });
});
