import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RegistrarLlegadaDpiModal } from './RegistrarLlegadaDpiModal';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { post: vi.fn() } }));
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

const OPERADOR = { id: '11111111-1111-4111-8111-111111111111', nombre: 'Ana López' };

function abrir(onDone = vi.fn(), onClose = vi.fn()) {
  render(<RegistrarLlegadaDpiModal operador={OPERADOR} onClose={onClose} onDone={onDone} />);
  return { user: userEvent.setup(), onDone, onClose };
}

describe('RegistrarLlegadaDpiModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('es un diálogo con título, explica que no borra el historial y enfoca el motivo', () => {
    abrir();

    expect(screen.getByRole('dialog', { name: 'Registrar llegada al DPEI' })).toBeInTheDocument();
    expect(screen.getByText(/Ana López/)).toBeInTheDocument();
    expect(screen.getByText(/no se borra su recorrido/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Motivo (requerido)')).toHaveFocus();
  });

  it('envía el motivo sin espacios de relleno y avisa al terminar', async () => {
    const { user, onDone } = abrir();
    postMock.mockResolvedValueOnce({ data: { id: 'x', ocurridoEn: '2026-10-30T23:00:00Z' } });

    await user.type(screen.getByLabelText('Motivo (requerido)'), '  Olvidó marcarla en la app  ');
    await user.click(screen.getByRole('button', { name: 'Registrar llegada' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(`/tracking/operadores/${OPERADOR.id}/llegada-dpi-manual`, {
        motivo: 'Olvidó marcarla en la app',
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('un motivo demasiado corto no se envía y el error se anuncia', async () => {
    const { user } = abrir();

    await user.type(screen.getByLabelText('Motivo (requerido)'), 'ab');
    await user.click(screen.getByRole('button', { name: 'Registrar llegada' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Escriba el motivo (mínimo 5 caracteres)');
    expect(screen.getByLabelText('Motivo (requerido)')).toHaveAttribute('aria-invalid', 'true');
    expect(postMock).not.toHaveBeenCalled();
  });

  it('muestra el mensaje de la API si no se pudo registrar', async () => {
    const { user, onDone } = abrir();
    postMock.mockRejectedValueOnce({ response: { data: { message: 'El operador aún no registra la salida del recinto' } } });

    await user.type(screen.getByLabelText('Motivo (requerido)'), 'Olvidó marcarla');
    await user.click(screen.getByRole('button', { name: 'Registrar llegada' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El operador aún no registra la salida del recinto');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('Cancelar cierra sin enviar', async () => {
    const { user, onClose } = abrir();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onClose).toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });
});
