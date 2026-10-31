import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@cne/shared-types';

import { ResetPasswordBulkModal } from './ResetPasswordBulkModal';
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

    expect(await screen.findByRole('alert')).toHaveTextContent(/revise el listado antes de reintentar/);
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
});
