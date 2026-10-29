import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ResumenCuentasCda } from '@cne/shared-types';

import { CuentasAppModal } from './CuentasAppModal';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

const RESUMEN: ResumenCuentasCda = {
  conCuenta: 70,
  sinCuenta: 51,
  pendientesCambioPwd: 40,
  bloqueadas: 2,
  cuentasSinVinculo: 10,
};

function renderModal(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CuentasAppModal onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('CuentasAppModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({ data: RESUMEN });
  });

  it('muestra los conteos de cuentas de operadores y asistentes', async () => {
    renderModal();

    const dialogo = await screen.findByRole('dialog', { name: 'Cuentas de la app' });
    expect(getMock).toHaveBeenCalledWith('/operadores-cda/cuentas/resumen');
    expect(await within(dialogo).findByText('70 de 121')).toBeInTheDocument();
    expect(within(dialogo).getByText(/51 sin cuenta/)).toBeInTheDocument();
    expect(within(dialogo).getByText('40')).toBeInTheDocument();
    expect(within(dialogo).getByText('2')).toBeInTheDocument();
  });

  it('crear y vincular: pide confirmación, llama a la API y anuncia el resultado', async () => {
    const user = userEvent.setup();
    postMock.mockResolvedValueOnce({ data: { vinculadas: 1, creadas: 50, fallidas: 0 } });
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Crear y vincular 51 cuentas' }));
    expect(postMock).not.toHaveBeenCalled();
    expect(screen.getByText(/misma contraseña inicial que “Restablecer clave”/)).toBeInTheDocument();
    expect(screen.getByText(/conservan su contraseña/)).toBeInTheDocument();
    // La advertencia se lee junto con los botones de la confirmación (el foco cae en "No, volver").
    expect(screen.getByRole('button', { name: 'No, volver' })).toHaveAccessibleDescription(/contraseña inicial/);
    expect(screen.getByRole('button', { name: 'Sí, crear y vincular' })).toHaveAccessibleDescription(/contraseña inicial/);
    await user.click(screen.getByRole('button', { name: 'Sí, crear y vincular' }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/operadores-cda/cuentas/sincronizar'));
    expect(await screen.findByRole('status')).toHaveTextContent('50 cuentas creadas y 1 vinculada');
    expect(getMock).toHaveBeenCalledTimes(2); // el resumen se vuelve a pedir
  });

  it('si algunas cuentas fallaron, lo dice y sugiere reintentar', async () => {
    const user = userEvent.setup();
    postMock.mockResolvedValueOnce({ data: { vinculadas: 0, creadas: 49, fallidas: 2 } });
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Crear y vincular 51 cuentas' }));
    await user.click(screen.getByRole('button', { name: 'Sí, crear y vincular' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      '49 cuentas creadas y 0 vinculadas. 2 no se pudieron crear: vuelva a pulsar “Crear y vincular”.',
    );
  });

  it('cancelar la confirmación no llama a la API', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Crear y vincular 51 cuentas' }));
    await user.click(screen.getByRole('button', { name: 'No, volver' }));

    expect(postMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Crear y vincular 51 cuentas' })).toBeInTheDocument();
  });

  it('desactivar cuentas sin vínculo: confirma con el número y anuncia el resultado', async () => {
    const user = userEvent.setup();
    postMock.mockResolvedValueOnce({ data: { desactivadas: 10 } });
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Desactivar 10 cuentas sin vínculo' }));
    expect(screen.getByText(/10 cuentas de Operador CDA que no corresponden a nadie/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sí, desactivar' }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/operadores-cda/cuentas/desactivar-sin-vinculo'));
    expect(await screen.findByRole('status')).toHaveTextContent('10 cuentas desactivadas');
  });

  it('sin pendientes, los botones quedan deshabilitados', async () => {
    getMock.mockResolvedValue({ data: { ...RESUMEN, sinCuenta: 0, cuentasSinVinculo: 0 } });
    renderModal();

    expect(await screen.findByRole('button', { name: 'Crear y vincular 0 cuentas' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Desactivar 0 cuentas sin vínculo' })).toBeDisabled();
  });

  it('un error de la API se anuncia como alerta', async () => {
    const user = userEvent.setup();
    postMock.mockRejectedValueOnce({ response: { data: { message: 'Falta el rol OPERADOR_CDA' } } });
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Crear y vincular 51 cuentas' }));
    await user.click(screen.getByRole('button', { name: 'Sí, crear y vincular' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Falta el rol OPERADOR_CDA');
  });

  it('si no carga el resumen, lo dice', async () => {
    getMock.mockRejectedValue(new Error('red'));
    renderModal();

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el resumen de cuentas');
  });
});
