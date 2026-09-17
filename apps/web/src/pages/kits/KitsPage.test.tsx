import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RoleName } from '@cne/shared-types';

import { KitsPage } from './KitsPage';
import { AuthProvider } from '../../auth/AuthContext';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
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
    return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 20 } });
  });
}

function renderKitsPage() {
  const qc = new QueryClient();
  return render(
    <AuthProvider>
      <QueryClientProvider client={qc}>
        <KitsPage />
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('KitsPage — botones de escritura ocultos para no-admin', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockApiResponses();
  });

  it('LECTOR no ve ningún botón de escritura', async () => {
    setSessionUser(['LECTOR']);
    renderKitsPage();

    await waitFor(() => expect(screen.getByText(/Evento:/)).toBeInTheDocument());

    expect(screen.queryByText('+ Nuevo kit')).not.toBeInTheDocument();
    expect(screen.queryByText('↓ Plantilla')).not.toBeInTheDocument();
    expect(screen.queryByText('↑ Importar')).not.toBeInTheDocument();
    expect(screen.queryByText('PDF QR')).not.toBeInTheDocument();
  });

  it('ADMINISTRADOR sí ve los botones de escritura', async () => {
    setSessionUser(['ADMINISTRADOR']);
    renderKitsPage();

    await waitFor(() => expect(screen.getByText(/Evento:/)).toBeInTheDocument());

    expect(screen.getByText('+ Nuevo kit')).toBeInTheDocument();
    expect(screen.getByText('↓ Plantilla')).toBeInTheDocument();
    expect(screen.getByText('↑ Importar')).toBeInTheDocument();
    expect(screen.getByText('PDF QR')).toBeInTheDocument();
  });
});
