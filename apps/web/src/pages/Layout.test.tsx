import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { RoleName } from '@cne/shared-types';

import { AuthProvider } from '../auth/AuthContext';
import { Layout } from './Layout';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { post: vi.fn(), get: vi.fn(), patch: vi.fn() },
  tokenStore: { set: vi.fn(), clear: vi.fn() },
}));

vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../components/NotificationsBell', () => ({
  NotificationsBell: () => <div>campanita</div>,
}));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;

const USER_KEY = 'cne.user';

function setSessionUser(roles: RoleName[]) {
  localStorage.setItem(
    USER_KEY,
    JSON.stringify({
      id: 'u1',
      email: 'user@cne-imbabura.gob.ec',
      nombres: 'Test',
      apellidos: 'User',
      debeCambiarPwd: false,
      roles,
    }),
  );
}

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<div>contenido</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function enlaceCaidoItem(id = 'n1', codigo = '978') {
  return {
    id,
    tipoEvento: 'ENLACE_CAIDO',
    canal: 'PUSH' as const,
    payload: { codigoRecinto: codigo, nombreRecinto: 'Escuela Central' },
    creadoEn: '2026-09-23T11:00:00.000Z',
    leidaEn: null,
  };
}

describe('Layout — barra lateral', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    apiGetMock.mockResolvedValue({ data: { items: [], total: 0, noLeidas: 0 } });
  });

  it('muestra el rol con un nombre legible en vez del valor interno', () => {
    setSessionUser(['TECNICO_SUPERVISOR']);
    renderLayout();
    expect(screen.getByText('Técnico supervisor')).toBeInTheDocument();
    expect(screen.queryByText('TECNICO_SUPERVISOR')).not.toBeInTheDocument();
  });

  it('agrupa los enlaces en un menú con nombre y deja "Cerrar sesión" fuera del área con scroll', () => {
    setSessionUser(['ADMINISTRADOR']);
    renderLayout();
    const menu = screen.getByRole('navigation', { name: 'Menú principal' });
    expect(within(menu).getByRole('link', { name: 'Monitoreo' })).toBeInTheDocument();
    const cerrar = screen.getByRole('button', { name: 'Cerrar sesión' });
    expect(menu).not.toContainElement(cerrar);
  });
});

describe('Layout — visibilidad del menú lateral por rol', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    apiGetMock.mockResolvedValue({ data: { items: [], total: 0, noLeidas: 0 } });
  });

  it('LECTOR no ve el link "Alertas" (fuera de su alcance) pero sí ve "Reportes"', () => {
    setSessionUser(['LECTOR']);
    renderLayout();
    expect(screen.queryByText('Alertas')).not.toBeInTheDocument();
    expect(screen.getByText('Reportes')).toBeInTheDocument();
  });

  it('ADMINISTRADOR ve tanto "Alertas" como "Reportes"', () => {
    setSessionUser(['ADMINISTRADOR']);
    renderLayout();
    expect(screen.getByText('Alertas')).toBeInTheDocument();
    expect(screen.getByText('Reportes')).toBeInTheDocument();
  });

  it('TECNICO_SUPERVISOR ve "Alertas" pero no "Reportes" (solo admin/lector)', () => {
    setSessionUser(['TECNICO_SUPERVISOR']);
    renderLayout();
    expect(screen.getByText('Alertas')).toBeInTheDocument();
    expect(screen.queryByText('Reportes')).not.toBeInTheDocument();
  });

  it('los dominios en alcance de LECTOR siempre se muestran', () => {
    setSessionUser(['LECTOR']);
    renderLayout();
    for (const label of [
      'Usuarios',
      'Militares',
      'Recintos Electorales',
      'Eventos Electorales',
      'Asignaciones',
      'Kits Electorales',
      'Monitoreo',
      'Incidencias',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('agrupa el menú en Preparación, Operación e Informes, con la preparación en orden de trabajo', () => {
    setSessionUser(['ADMINISTRADOR']);
    renderLayout();
    const etiquetas = (grupo: string) =>
      within(screen.getByRole('group', { name: grupo }))
        .getAllByRole('link')
        .map((l) => l.textContent);
    expect(etiquetas('Preparación')).toEqual([
      'Estado de la preparación',
      'Recintos Electorales',
      'Usuarios',
      'Militares',
      'Eventos Electorales',
      'Asignaciones',
      'Kits Electorales',
    ]);
    expect(etiquetas('Operación')).toEqual(['Monitoreo', 'Incidencias', 'Alertas']);
    expect(etiquetas('Informes')).toEqual(['Cadena de custodia', 'Reportes', 'Power BI CDAS']);
    const hrefs = within(screen.getByRole('group', { name: 'Preparación' }))
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'));
    expect(hrefs).toEqual(['/', '/recintos', '/users', '/militares', '/eventos', '/asignaciones', '/kits']);
  });

  it('ASISTENTE_TRANSVERSAL solo tiene el grupo Informes (sin títulos de grupos vacíos)', () => {
    setSessionUser(['ASISTENTE_TRANSVERSAL']);
    renderLayout();
    expect(screen.queryByRole('group', { name: 'Preparación' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Operación' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Informes' })).toBeInTheDocument();
  });

  it('TECNICO_SUPERVISOR ve Alertas en Operación, y solo Power BI en Informes', () => {
    setSessionUser(['TECNICO_SUPERVISOR']);
    renderLayout();
    const etiquetas = (grupo: string) =>
      within(screen.getByRole('group', { name: grupo }))
        .getAllByRole('link')
        .map((l) => l.textContent);
    expect(etiquetas('Operación')).toEqual(['Monitoreo', 'Incidencias', 'Alertas']);
    expect(etiquetas('Informes')).toEqual(['Power BI CDAS']);
  });

  it('ASISTENTE_TRANSVERSAL solo ve "CDAs" y "Cadena de custodia" (el resto no le corresponde)', () => {
    setSessionUser(['ASISTENTE_TRANSVERSAL']);
    renderLayout();
    const menu = screen.getByRole('navigation', { name: 'Menú principal' });
    expect(within(menu).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'CDAs',
      'Cadena de custodia',
    ]);
  });

  it('"CDAs" aparece en el grupo Personal para administrador y técnico supervisor, no para el lector', () => {
    for (const rol of ['ADMINISTRADOR', 'TECNICO_SUPERVISOR'] as const) {
      setSessionUser([rol]);
      const { unmount } = renderLayout();
      expect(within(screen.getByRole('group', { name: 'Personal' })).getByRole('link', { name: 'CDAs' })).toHaveAttribute('href', '/operadores-cda');
      unmount();
    }
    setSessionUser(['LECTOR']);
    renderLayout();
    expect(screen.queryByRole('link', { name: 'CDAs' })).not.toBeInTheDocument();
  });

  it('ADMINISTRADOR y LECTOR ven "Cadena de custodia"; TECNICO_SUPERVISOR no', () => {
    for (const [rol, ve] of [
      ['ADMINISTRADOR', true],
      ['LECTOR', true],
      ['TECNICO_SUPERVISOR', false],
    ] as const) {
      setSessionUser([rol]);
      const { unmount } = renderLayout();
      expect(!!screen.queryByText('Cadena de custodia')).toBe(ve);
      unmount();
    }
  });
});

describe('Layout — sin banner de enlace caído', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    setSessionUser(['ADMINISTRADOR']);
  });

  it('no muestra banner aunque haya notificaciones ENLACE_CAIDO sin leer (quedan en la campanita)', async () => {
    apiGetMock.mockResolvedValue({
      data: { items: [enlaceCaidoItem()], total: 1, noLeidas: 1 },
    });

    renderLayout();
    await screen.findByText('contenido');

    expect(screen.getByText('campanita')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ya notifiqué' })).not.toBeInTheDocument();
  });
});

describe('Layout — módulos configurados por el administrador', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  function responderModulos(modulos: string[]) {
    apiGetMock.mockImplementation((url: string) =>
      Promise.resolve({
        data: url === '/permisos-modulos/mios' ? { modulos } : { items: [], total: 0, noLeidas: 0 },
      }),
    );
  }

  it('oculta del menú los módulos que el administrador quitó al rol, y los grupos que quedan vacíos', async () => {
    setSessionUser(['TECNICO_SUPERVISOR']);
    responderModulos(['monitoreo', 'kits']);
    renderLayout();
    await waitFor(() => expect(screen.queryByText('Incidencias')).not.toBeInTheDocument());
    const menu = screen.getByRole('navigation', { name: 'Menú principal' });
    expect(within(menu).getAllByRole('link').map((l) => l.textContent)).toEqual(['Kits Electorales', 'Monitoreo']);
    expect(screen.queryByRole('group', { name: 'Informes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Personal' })).not.toBeInTheDocument();
  });

  it('solo el administrador ve el acceso a "Módulos por rol"', () => {
    responderModulos([]);
    setSessionUser(['ADMINISTRADOR']);
    const { unmount } = renderLayout();
    expect(
      within(screen.getByRole('group', { name: 'Administración' })).getByRole('link', { name: 'Módulos por rol' }),
    ).toHaveAttribute('href', '/configuracion/modulos');
    unmount();

    setSessionUser(['TECNICO_SUPERVISOR']);
    renderLayout();
    expect(screen.queryByRole('link', { name: 'Módulos por rol' })).not.toBeInTheDocument();
  });
});
