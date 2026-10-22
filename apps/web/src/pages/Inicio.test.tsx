import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { RoleName } from '@cne/shared-types';

import { AuthProvider } from '../auth/AuthContext';
import { Inicio } from './Inicio';

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
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/reportes/cadena-custodia" element={<div>informe de custodia</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('Inicio', () => {
  beforeEach(() => localStorage.clear());

  it.each<RoleName>(['ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'LECTOR'])('%s ve el panel de preparación', (rol) => {
    renderInicio([rol]);
    expect(screen.getByText('panel de preparación')).toBeInTheDocument();
  });

  it('el asistente transversal va a su informe de cadena de custodia', () => {
    renderInicio(['ASISTENTE_TRANSVERSAL']);
    expect(screen.getByText('informe de custodia')).toBeInTheDocument();
    expect(screen.queryByText('panel de preparación')).not.toBeInTheDocument();
  });
});
