import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SyncRecintosPreview } from '@cne/shared-types';

import { SyncRecintosModal } from './SyncRecintosModal';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;
const apiPost = api.post as unknown as ReturnType<typeof vi.fn>;

function preview(over: Partial<SyncRecintosPreview> = {}): SyncRecintosPreview {
  return {
    leidos: { cda: 55, noCda: 82 },
    sinCambios: 134,
    cambios: [
      { codigoRecinto: '8587', nombre: 'UE San Daniel Comboni', accion: 'CREAR', cambios: [] },
      {
        codigoRecinto: '937',
        nombre: 'EEB FAE Cuajara',
        accion: 'ACTUALIZAR',
        cambios: [{ campo: 'CDA destino', antes: '1207', despues: '8587' }],
        nota: 'El CDA 1207 ya no está en la hoja de CDAs: se asigna 8587.',
      },
    ],
    errores: [
      {
        codigoRecinto: '1207',
        nombre: 'EEB FAE Guallupe',
        error: 'Ya no está en el Sheet pero tiene 1 kit(s) en el evento activo',
      },
    ],
    congelado: false,
    ocultamientoMasivo: false,
    ...over,
  };
}

function renderModal(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SyncRecintosModal onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe('SyncRecintosModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('muestra el resumen, los errores y los cambios campo por campo', async () => {
    apiGet.mockResolvedValue({ data: preview() });
    renderModal();

    expect(await screen.findByText(/con cambios/)).toHaveTextContent('Leídos 55 CDA y 82 NO CDA · 2 con cambios · 134 sin cambios · 1 con errores');
    const errores = screen.getByRole('region', { name: /No se cambiarán \(1\)/ });
    expect(within(errores).getByText(/1207/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Recintos nuevos \(1\)/ })).toHaveTextContent('8587 UE San Daniel Comboni');
    const cambian = screen.getByRole('region', { name: /Recintos que cambian \(1\)/ });
    expect(cambian).toHaveTextContent(/CDA destino: 1207 → pasa a 8587/);
    expect(cambian).toHaveTextContent(/se asigna 8587/);
    expect(apiGet).toHaveBeenCalledWith('/recintos/sync/preview');
  });

  it('aplica los cambios, avisa lo omitido y se cierra', async () => {
    apiGet.mockResolvedValue({ data: preview() });
    apiPost.mockResolvedValue({
      data: { aplicados: 2, creados: 1, actualizados: 1, ocultados: 0, errores: preview().errores },
    });
    const onClose = renderModal();

    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar cambios (2)' }));

    expect(apiPost).toHaveBeenCalledWith('/recintos/sync');
    expect(sileo.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Sincronización aplicada: 1 nuevo(s), 1 actualizado(s), 0 oculto(s).',
        description: expect.stringMatching(/1 recinto/),
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('con la jornada iniciada avisa y no deja aplicar', async () => {
    apiGet.mockResolvedValue({ data: preview({ congelado: true }) });
    renderModal();

    expect(await screen.findByRole('alert')).toHaveTextContent(/jornada electoral ya inició/);
    expect(screen.getByRole('button', { name: /Aplicar cambios/ })).toBeDisabled();
  });

  it('si todo coincide lo dice y no hay nada que aplicar', async () => {
    apiGet.mockResolvedValue({ data: preview({ cambios: [], errores: [], sinCambios: 137 }) });
    renderModal();

    expect(await screen.findByText('El sistema ya coincide con el Google Sheet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar cambios (0)' })).toBeDisabled();
  });

  it('muestra el error del servidor si no se pudo leer el Sheet', async () => {
    apiGet.mockRejectedValue({ response: { data: { message: 'RECINTOS_SHEET_ID no está configurado' } } });
    renderModal();

    expect(await screen.findByRole('alert')).toHaveTextContent('RECINTOS_SHEET_ID no está configurado');
  });

  it('pide confirmación antes de ocultar recintos y no aplica si se cancela', async () => {
    apiGet.mockResolvedValue({
      data: preview({ cambios: [{ codigoRecinto: '500', nombre: 'Viejo', accion: 'OCULTAR', cambios: [] }] }),
    });
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderModal();

    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar cambios (1)' }));

    expect(confirmar).toHaveBeenCalledWith(expect.stringMatching(/Se ocultarán 1 recinto/));
    expect(apiPost).not.toHaveBeenCalled();
    confirmar.mockRestore();
  });

  it('con un ocultamiento masivo avisa y no deja aplicar', async () => {
    apiGet.mockResolvedValue({
      data: preview({
        ocultamientoMasivo: true,
        cambios: [{ codigoRecinto: '500', nombre: 'Viejo', accion: 'OCULTAR', cambios: [] }],
      }),
    });
    renderModal();

    expect(await screen.findByText(/Se ocultarían 1 recintos de una vez/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aplicar cambios/ })).toBeDisabled();
  });

  it('enfoca "Cancelar" al abrir y mantiene Tab dentro del diálogo', async () => {
    apiGet.mockResolvedValue({ data: preview() });
    renderModal();
    const aplicarBtn = await screen.findByRole('button', { name: 'Aplicar cambios (2)' });
    const cancelar = screen.getByRole('button', { name: 'Cancelar' });
    expect(cancelar).toHaveFocus();

    aplicarBtn.focus();
    await userEvent.tab();
    expect(cancelar).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(aplicarBtn).toHaveFocus();
  });

  it('se cierra con Escape', async () => {
    apiGet.mockResolvedValue({ data: preview() });
    const onClose = renderModal();

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });
});
