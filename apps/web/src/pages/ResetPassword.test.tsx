import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { ResetPassword } from './ResetPassword';

vi.mock('../lib/api', () => ({ api: { post: vi.fn() }, tokenStore: { set: vi.fn(), clear: vi.fn() } }));

describe('ResetPassword', () => {
  it('sin token muestra un título y anuncia que el enlace no sirve', () => {
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <ResetPassword />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Restablecer contraseña' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Enlace de recuperación inválido o expirado');
    expect(screen.getByRole('link', { name: 'Solicitar un nuevo enlace' })).toHaveAttribute('href', '/forgot-password');
  });

  it('con token, los dos campos de contraseña tienen su etiqueta', () => {
    render(
      <MemoryRouter initialEntries={['/reset-password?token=abc']}>
        <ResetPassword />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Nueva contraseña')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirmar nueva contraseña')).toBeInTheDocument();
  });
});
