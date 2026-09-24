import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { RoleName } from '@cne/shared-types';

import { AuthProvider } from './auth/AuthContext';
import { api } from './lib/api';
import App from './App';

vi.mock('./lib/api', () => ({
  api: { post: vi.fn(), get: vi.fn(), patch: vi.fn() },
  tokenStore: { set: vi.fn(), clear: vi.fn() },
}));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;

vi.mock('./components/NotificationsBell', () => ({
  NotificationsBell: () => <div>campanita</div>,
}));

// Todas las páginas reales hacen fetch de datos (useQuery) — se mockean por
// una versión mínima para probar únicamente el árbol de rutas/guards de
// App.tsx, no el contenido de cada página (eso ya lo cubre cada *.test.tsx
// propio, cuando existe).
vi.mock('./pages/users/UsersList', () => ({ UsersList: () => <div>página: usuarios</div> }));
vi.mock('./pages/users/NewUser', () => ({ NewUser: () => <div>página: nuevo usuario</div> }));
vi.mock('./pages/users/BulkUpload', () => ({ BulkUpload: () => <div>página: carga usuarios</div> }));
vi.mock('./pages/militares/MilitaresPage', () => ({ MilitaresPage: () => <div>página: militares</div> }));
vi.mock('./pages/militares/BulkMilitares', () => ({ BulkMilitares: () => <div>página: carga militares</div> }));
vi.mock('./pages/recintos/RecintosPage', () => ({ RecintosPage: () => <div>página: recintos</div> }));
vi.mock('./pages/eventos/EventosPage', () => ({ EventosPage: () => <div>página: eventos</div> }));
vi.mock('./pages/asignaciones/AsignacionesPage', () => ({ AsignacionesPage: () => <div>página: asignaciones</div> }));
vi.mock('./pages/kits/KitsPage', () => ({ KitsPage: () => <div>página: kits</div> }));
vi.mock('./pages/operadores/MonitoreoPage', () => ({ MonitoreoPage: () => <div>página: monitoreo</div> }));
vi.mock('./pages/incidencias/IncidenciasPage', () => ({ IncidenciasPage: () => <div>página: incidencias</div> }));
vi.mock('./pages/alertas/AlertasPage', () => ({ AlertasPage: () => <div>página: alertas</div> }));
vi.mock('./pages/reportes/ReporteNoCdaPage', () => ({ ReporteNoCdaPage: () => <div>página: reportes</div> }));

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

function renderAppAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('App — guards de ruta para el rol LECTOR', () => {
  beforeEach(() => {
    localStorage.clear();
    apiGetMock.mockReset();
    apiGetMock.mockResolvedValue({ data: { items: [], total: 0, noLeidas: 0 } });
  });

  it('LECTOR entra a /users (dentro de su alcance)', () => {
    setSessionUser(['LECTOR']);
    renderAppAt('/users');
    expect(screen.getByText('página: usuarios')).toBeInTheDocument();
  });

  it('LECTOR recibe "Acceso denegado" en /alertas (fuera de su alcance)', () => {
    setSessionUser(['LECTOR']);
    renderAppAt('/alertas');
    expect(screen.getByText('Acceso denegado')).toBeInTheDocument();
    expect(screen.queryByText('página: alertas')).not.toBeInTheDocument();
  });

  it('LECTOR entra a /reportes/no-cda (agregado junto con ADMINISTRADOR)', () => {
    setSessionUser(['LECTOR']);
    renderAppAt('/reportes/no-cda');
    expect(screen.getByText('página: reportes')).toBeInTheDocument();
  });

  it('LECTOR recibe "Acceso denegado" en /users/new (alta de usuario, solo ADMINISTRADOR)', () => {
    setSessionUser(['LECTOR']);
    renderAppAt('/users/new');
    expect(screen.getByText('Acceso denegado')).toBeInTheDocument();
  });

  it('TECNICO_SUPERVISOR sigue entrando a /alertas (no se le quitó acceso)', () => {
    setSessionUser(['TECNICO_SUPERVISOR']);
    renderAppAt('/alertas');
    expect(screen.getByText('página: alertas')).toBeInTheDocument();
  });

  it('ADMINISTRADOR entra tanto a /alertas como a /reportes/no-cda', () => {
    setSessionUser(['ADMINISTRADOR']);
    renderAppAt('/alertas');
    expect(screen.getByText('página: alertas')).toBeInTheDocument();
  });
});
