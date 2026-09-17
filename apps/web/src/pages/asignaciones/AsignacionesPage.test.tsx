import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RoleName } from '@cne/shared-types';

import { AsignacionesPage } from './AsignacionesPage';
import { AuthProvider } from '../../auth/AuthContext';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), post: vi.fn() },
}));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

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

function mockApiResponses() {
  getMock.mockImplementation((url: string) => {
    if (url.startsWith('/eventos')) {
      return Promise.resolve({
        data: [{ id: 'evt1', nombre: 'Evento 1', estado: 'ACTIVO', fechaJornada: '2026-01-01' }],
      });
    }
    if (url.includes('role=OPERADOR_CDA')) {
      return Promise.resolve({
        data: {
          items: [{ id: 'op1', nombres: 'Juan', apellidos: 'Perez', cedula: '1710034065' }],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      });
    }
    if (url.includes('role=TECNICO_SUPERVISOR')) {
      return Promise.resolve({
        data: {
          items: [{ id: 'sup1', nombres: 'Sup', apellidos: 'Visor', cedula: '0926687856' }],
          total: 1,
          page: 1,
          pageSize: 500,
        },
      });
    }
    if (url.startsWith('/asignaciones')) {
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 20 } });
  });
}

function renderAsignacionesPage() {
  const qc = new QueryClient();
  return render(
    <AuthProvider>
      <QueryClientProvider client={qc}>
        <AsignacionesPage />
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('AsignacionesPage — escritura deshabilitada para no-admin', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockApiResponses();
  });

  it('LECTOR no ve "Plantilla"/"Importar" y el selector de supervisor está deshabilitado', async () => {
    setSessionUser(['LECTOR']);
    renderAsignacionesPage();

    await waitFor(() => expect(screen.getByText('Juan Perez')).toBeInTheDocument());

    expect(screen.queryByText('↓ Plantilla')).not.toBeInTheDocument();
    expect(screen.queryByText('↑ Importar')).not.toBeInTheDocument();
    const fila = screen.getByText('Juan Perez').closest('tr')!;
    expect(within(fila).getByRole('combobox')).toBeDisabled();
  });

  it('ADMINISTRADOR ve "Plantilla"/"Importar" y el selector de supervisor está habilitado', async () => {
    setSessionUser(['ADMINISTRADOR']);
    renderAsignacionesPage();

    await waitFor(() => expect(screen.getByText('Juan Perez')).toBeInTheDocument());

    expect(screen.getByText('↓ Plantilla')).toBeInTheDocument();
    expect(screen.getByText('↑ Importar')).toBeInTheDocument();
    const fila = screen.getByText('Juan Perez').closest('tr')!;
    expect(within(fila).getByRole('combobox')).toBeEnabled();
  });
});
