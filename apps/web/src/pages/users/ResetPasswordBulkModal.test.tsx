import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@cne/shared-types';

import { ResetPasswordBulkModal, TAMANO_LOTE } from './ResetPasswordBulkModal';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { post: vi.fn() } }));
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

const u = (id: string, roles: string[]) => ({ id, nombres: id, apellidos: 'X', roles }) as unknown as User;

describe('ResetPasswordBulkModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cuenta por rol, incluidos los usuarios sin rol', () => {
    render(
      <ResetPasswordBulkModal
        users={[u('a', ['OPERADOR_CDA']), u('b', ['OPERADOR_CDA']), u('c', [])]}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveTextContent('OPERADOR_CDA: 2');
    expect(dialogo).toHaveTextContent('Sin rol: 1');
  });

  it('sin respuesta del servidor avisa que pudo quedar a medias', async () => {
    postMock.mockRejectedValueOnce(new Error('timeout'));
    render(<ResetPasswordBulkModal users={[u('a', ['OPERADOR_CDA'])]} onClose={vi.fn()} onDone={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Restablecer 1 claves' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Faltan 1: pulse "Restablecer 1 claves" para seguir.');
  });

  it('mientras restablece, Escape no cierra el diálogo', async () => {
    postMock.mockReturnValueOnce(new Promise(() => undefined));
    const onClose = vi.fn();
    render(<ResetPasswordBulkModal users={[u('a', ['OPERADOR_CDA'])]} onClose={onClose} onDone={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Restablecer 1 claves' }));
    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Restableciendo…' })).toBeDisabled();
  });

  it('envía por lotes y suma el resultado de todos', async () => {
    const usuarios = Array.from({ length: TAMANO_LOTE * 2 + 5 }, (_, i) => u(`u${i}`, ['OPERADOR_CDA']));
    postMock.mockImplementation((_url: string, body: { userIds: string[] }) =>
      Promise.resolve({ data: { restablecidos: body.userIds.length, omitidos: [] } }),
    );
    render(<ResetPasswordBulkModal users={usuarios} onClose={vi.fn()} onDone={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole('button', { name: `Restablecer ${usuarios.length} claves` }));

    await screen.findByRole('button', { name: 'Listo' });
    expect(screen.getByRole('status')).toHaveTextContent('45 clave(s) restablecida(s)');
    expect(postMock).toHaveBeenCalledTimes(3);
    expect(postMock.mock.calls.map(([, body]) => body.userIds.length)).toEqual([TAMANO_LOTE, TAMANO_LOTE, 5]);
  });

  it('si falla un lote, "Continuar" sigue con los que faltan sin repetir los hechos', async () => {
    const usuarios = Array.from({ length: TAMANO_LOTE + 3 }, (_, i) => u(`u${i}`, ['OPERADOR_CDA']));
    postMock
      .mockResolvedValueOnce({ data: { restablecidos: TAMANO_LOTE, omitidos: [] } })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: { restablecidos: 3, omitidos: [] } });
    const onDone = vi.fn();
    render(<ResetPasswordBulkModal users={usuarios} onClose={vi.fn()} onDone={onDone} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: `Restablecer ${usuarios.length} claves` }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`Van ${TAMANO_LOTE} restablecida(s)`);

    await user.click(screen.getByRole('button', { name: 'Continuar con 3 claves' }));

    await screen.findByRole('button', { name: 'Listo' });
    expect(screen.getByRole('status')).toHaveTextContent('23 clave(s) restablecida(s)');
    expect(postMock.mock.calls[2][1].userIds).toEqual(['u20', 'u21', 'u22']);
  });

  it('cancelar tras restablecer una parte avisa al listado para refrescarse', async () => {
    const usuarios = Array.from({ length: TAMANO_LOTE + 1 }, (_, i) => u(`u${i}`, ['OPERADOR_CDA']));
    postMock
      .mockResolvedValueOnce({ data: { restablecidos: TAMANO_LOTE, omitidos: [] } })
      .mockRejectedValueOnce(new Error('timeout'));
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(<ResetPasswordBulkModal users={usuarios} onClose={onClose} onDone={onDone} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: `Restablecer ${usuarios.length} claves` }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onDone).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('si el servidor rechaza un lote a mitad (p. ej. 429), muestra el avance y cómo seguir', async () => {
    const usuarios = Array.from({ length: TAMANO_LOTE + 3 }, (_, i) => u(`u${i}`, ['OPERADOR_CDA']));
    postMock
      .mockResolvedValueOnce({ data: { restablecidos: TAMANO_LOTE, omitidos: [] } })
      .mockRejectedValueOnce({ response: { data: { message: 'Demasiadas solicitudes' } } });
    render(<ResetPasswordBulkModal users={usuarios} onClose={vi.fn()} onDone={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole('button', { name: `Restablecer ${usuarios.length} claves` }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Van ${TAMANO_LOTE} restablecida(s). Demasiadas solicitudes Faltan 3: pulse "Continuar con 3 claves" para seguir.`,
    );
  });

  it('la lista queda fija al abrir aunque el listado se refresque', async () => {
    postMock.mockResolvedValue({ data: { restablecidos: 1, omitidos: [] } });
    const { rerender } = render(<ResetPasswordBulkModal users={[u('a', ['OPERADOR_CDA'])]} onClose={vi.fn()} onDone={vi.fn()} />);
    rerender(<ResetPasswordBulkModal users={[u('b', ['OPERADOR_CDA']), u('c', [])]} onClose={vi.fn()} onDone={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Restablecer 1 claves' }));

    await screen.findByRole('button', { name: 'Listo' });
    expect(postMock).toHaveBeenCalledWith('/users/reset-password-bulk', { userIds: ['a'] });
  });
});
