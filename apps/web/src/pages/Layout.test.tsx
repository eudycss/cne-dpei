import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { RoleName } from '@cne/shared-types';

import { AuthProvider } from '../auth/AuthContext';
import { Layout } from './Layout';

vi.mock('../lib/api', () => ({
  api: { post: vi.fn(), get: vi.fn() },
  tokenStore: { set: vi.fn(), clear: vi.fn() },
}));

vi.mock('../components/NotificationsBell', () => ({
  NotificationsBell: () => <div>campanita</div>,
}));

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
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>contenido</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('Layout — visibilidad del menú lateral por rol', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
