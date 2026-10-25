import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sileo } from 'sileo';

import { PermisosModulosPage } from './PermisosModulosPage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const putMock = api.put as unknown as ReturnType<typeof vi.fn>;

const MATRIZ = {
  roles: [
    { rol: 'TECNICO_SUPERVISOR', modulos: ['kits', 'alertas'], permisos: [] },
    { rol: 'LECTOR', modulos: ['kits', 'reportes'], permisos: [] },
    {
      rol: 'ASISTENTE_TRANSVERSAL',
      modulos: ['cadena-custodia', 'operadores-cda'],
      permisos: ['cda.asistencia.marcar', 'cda.asistencia.qr'],
    },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PermisosModulosPage />
    </QueryClientProvider>,
  );
}

const casilla = (nombre: string) => screen.getByRole('checkbox', { name: nombre });

describe('PermisosModulosPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({ data: MATRIZ });
    putMock.mockImplementation((url: string, body: { modulos: string[]; permisos: string[] }) =>
      Promise.resolve({ data: { rol: url.split('/').pop(), ...body } }),
    );
  });

  it('marca los módulos que cada rol ve hoy', async () => {
    renderPage();
    expect(await screen.findByRole('checkbox', { name: 'Kits Electorales para Técnico supervisor' })).toBeChecked();
    expect(casilla('Incidencias para Técnico supervisor')).not.toBeChecked();
    expect(casilla('Cadena de custodia para Asistente Electoral Transversal')).toBeChecked();
  });

  it('deshabilita las casillas que el servidor no permite a ese rol y explica por qué', async () => {
    renderPage();
    const alertasLector = await screen.findByRole('checkbox', { name: 'Alertas para Lector' });
    expect(alertasLector).toBeDisabled();
    expect(alertasLector).toHaveAccessibleDescription(/no están disponibles para ese rol/);
    expect(casilla('Alertas para Técnico supervisor')).toBeEnabled();
  });

  it('guarda solo los roles que cambiaron', async () => {
    const user = userEvent.setup();
    renderPage();
    const guardar = await screen.findByRole('button', { name: 'Guardar cambios' });
    expect(guardar).toBeDisabled();

    await user.click(casilla('Incidencias para Técnico supervisor'));
    await user.click(casilla('Alertas para Técnico supervisor'));
    await user.click(guardar);

    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(putMock).toHaveBeenCalledWith('/permisos-modulos/TECNICO_SUPERVISOR', {
      modulos: ['kits', 'incidencias'],
      permisos: [],
    });
    expect(sileo.success).toHaveBeenCalled();
  });

  it('"Restaurar valores de fábrica" vuelve a la visibilidad original', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('checkbox', { name: 'Kits Electorales para Técnico supervisor' });
    await user.click(screen.getByRole('button', { name: 'Restaurar valores de fábrica' }));
    expect(casilla('Incidencias para Técnico supervisor')).toBeChecked();
    expect(casilla('CDAs (Operadores y Asistentes) para Asistente Electoral Transversal')).toBeChecked();
  });

  it('avisa el error del servidor al guardar', async () => {
    putMock.mockRejectedValueOnce({ response: { data: { message: 'Módulos no disponibles para este rol: alertas' } } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: 'Reportes para Lector' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(sileo.error).toHaveBeenCalledWith({ title: 'Módulos no disponibles para este rol: alertas' }),
    );
  });

  it('si el servidor devuelve una lista de mensajes, los une en uno', async () => {
    putMock.mockRejectedValueOnce({ response: { data: { message: ['modulos inválido', 'falta rol'] } } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: 'Reportes para Lector' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'modulos inválido, falta rol' }));
  });

  it('dice por qué "Guardar" está deshabilitado y qué roles tienen cambios pendientes', async () => {
    const user = userEvent.setup();
    renderPage();
    const guardar = await screen.findByRole('button', { name: 'Guardar cambios' });
    expect(guardar).toBeDisabled();
    expect(guardar).toHaveAccessibleDescription('No hay cambios por guardar.');
    await user.click(casilla('Reportes para Lector'));
    expect(guardar).toBeEnabled();
    expect(guardar).toHaveAccessibleDescription('Cambios sin guardar en: Lector.');
  });

  it('si no carga la configuración, permite reintentar', async () => {
    getMock.mockRejectedValueOnce(new Error('caído'));
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la configuración de módulos.');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('checkbox', { name: 'Kits Electorales para Técnico supervisor' })).toBeChecked();
  });
  describe('acciones dentro de cada módulo', () => {
    const AET = 'Asistente Electoral Transversal';
    const accion = (texto: string, rol = AET) => casilla(`CDAs (Operadores y Asistentes): ${texto}, para ${rol}`);

    it('marca las acciones que tiene cada rol (el asistente toma asistencia pero no emite carnets)', async () => {
      renderPage();
      await screen.findByRole('checkbox', { name: 'Kits Electorales para Técnico supervisor' });
      expect(accion('Marcar o quitar asistencia a mano')).toBeChecked();
      expect(accion('Marcar asistencia escaneando el carnet')).toBeChecked();
      expect(accion('Emitir o anular carnets QR')).not.toBeChecked();
    });

    it('sin el módulo, sus acciones quedan deshabilitadas y se explica por qué', async () => {
      renderPage();
      await screen.findByRole('checkbox', { name: 'Kits Electorales para Técnico supervisor' });
      const tec = accion('Emitir o anular carnets QR', 'Técnico supervisor');
      expect(tec).toBeDisabled();
      expect(tec).toHaveAccessibleDescription(/solo se pueden dar si el rol ve el módulo/);
      // El lector nunca puede tener acciones de CDAs (techo del servidor).
      expect(accion('Exportar asistencia y atrasos', 'Lector')).toHaveAccessibleDescription(/no están disponibles/);
    });

    it('al quitar el módulo, sus acciones se deshabilitan y no se guardan', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('checkbox', { name: `CDAs (Operadores y Asistentes) para ${AET}` }));
      expect(accion('Marcar o quitar asistencia a mano')).toBeDisabled();
      expect(accion('Marcar o quitar asistencia a mano')).not.toBeChecked();
      // Al volver a activarlo, las acciones no reaparecen solas.
      await user.click(casilla(`CDAs (Operadores y Asistentes) para ${AET}`));
      expect(accion('Marcar o quitar asistencia a mano')).toBeEnabled();
      expect(accion('Marcar o quitar asistencia a mano')).not.toBeChecked();
    });

    it('guarda las acciones junto con los módulos del rol', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('checkbox', { name: 'Kits Electorales para Técnico supervisor' });
      await user.click(accion('Marcar o quitar asistencia a mano'));
      await user.click(accion('Emitir o anular carnets QR'));
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
      await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
      expect(putMock).toHaveBeenCalledWith('/permisos-modulos/ASISTENTE_TRANSVERSAL', {
        modulos: ['cadena-custodia', 'operadores-cda'],
        permisos: ['cda.asistencia.qr', 'cda.carnets.emitir'],
      });
    });
  });
});
