import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

function Demo({ onClose = vi.fn(), autoFocus = false }: { onClose?: () => void; autoFocus?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button onClick={() => setAbierto(true)}>Abrir</button>
      {abierto && (
        <Modal
          labelledBy="t"
          onClose={() => {
            onClose();
            setAbierto(false);
          }}
        >
          <h1 id="t">Título</h1>
          <input aria-label="Nombre" />
          <textarea aria-label="Motivo" autoFocus={autoFocus} />
          <button>Guardar</button>
        </Modal>
      )}
    </>
  );
}

describe('Modal', () => {
  it('es un diálogo con nombre y enfoca el primer control', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(screen.getByRole('dialog', { name: 'Título' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Nombre')).toHaveFocus();
  });

  it('mantiene Tab y Shift+Tab dentro del diálogo', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    await user.tab();
    expect(screen.getByLabelText('Motivo')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Nombre')).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveFocus();
  });

  it('Escape cierra y devuelve el foco a quien lo abrió', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    await user.click(abrir);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(abrir).toHaveFocus();
  });

  it('con un hijo autoFocus respeta ese foco y al cerrar vuelve al botón que lo abrió', async () => {
    const user = userEvent.setup();
    render(<Demo autoFocus />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    await user.click(abrir);
    expect(screen.getByLabelText('Motivo')).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(abrir).toHaveFocus();
  });
});
