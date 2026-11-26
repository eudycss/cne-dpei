import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PasswordField } from './PasswordField';

describe('PasswordField', () => {
  it('la etiqueta está asociada al campo (el lector de pantalla la anuncia)', () => {
    render(
      <>
        <PasswordField label="Nueva contraseña" value="" onChange={() => {}} />
        <PasswordField label="Confirmar nueva contraseña" value="" onChange={() => {}} />
      </>,
    );
    expect(screen.getByLabelText('Nueva contraseña')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirmar nueva contraseña')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Nueva contraseña')).not.toBe(screen.getByLabelText('Confirmar nueva contraseña'));
  });

  it('el botón del ojo muestra la contraseña e indica su estado con aria-pressed', async () => {
    render(<PasswordField label="Contraseña" value="secreta" onChange={() => {}} />);
    const boton = screen.getByRole('button', { name: 'Mostrar contraseña' });
    expect(boton).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(boton);
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toHaveAttribute('aria-pressed', 'true');
  });
});
