import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { RoleName } from '@cne/shared-types';

import { AuthProvider } from '../auth/AuthContext';
import { Inicio } from './Inicio';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { post: vi.fn(), get: vi.fn(), patch: vi.fn() },
  tokenStore: { set: vi.fn(), clear: vi.fn() },
}));

vi.mock('./inicio/PreparacionPage', () => ({
  PreparacionPage: () => <div>panel de preparación</div>,
}));

function renderInicio(roles: RoleName[]) {
  localStorage.setItem(
    'cne.user',
    JSON.stringify({
      id: 'u1',
      email: 'user@cne-imbabura.gob.ec',
      nombres: 'Test',
      apellidos: 'User',
      debeCambiarPwd: false,
      roles,
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Inicio />} />
            <Route path="/reportes/cadena-custodia" element={<div>informe de custodia</div>} />
            <Route path="/kits" element={<div>página de kits</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('Inicio', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.get).mockReset();
  });

  it.each<RoleName>(['ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'LECTOR'])('%s ve el panel de preparación', async (rol) => {
    vi.mocked(api.get).mockResolvedValue({ data: { modulos: ['inicio'] } });
    renderInicio([rol]);
    expect(await screen.findByText('panel de preparación')).toBeInTheDocument();
  });

  it('el asistente transversal va a su informe de cadena de custodia', () => {
    renderInicio(['ASISTENTE_TRANSVERSAL']);
    expect(screen.getByText('informe de custodia')).toBeInTheDocument();
    expect(screen.queryByText('panel de preparación')).not.toBeInTheDocument();
  });

  it('si el administrador le ocultó la preparación, va al primer módulo que sí puede ver', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { modulos: ['kits'] } });
    renderInicio(['TECNICO_SUPERVISOR']);
    expect(await screen.findByText('página de kits')).toBeInTheDocument();
    expect(screen.queryByText('panel de preparación')).not.toBeInTheDocument();
  });
});
