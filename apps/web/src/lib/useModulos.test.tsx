import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useModulos } from './useModulos';
import { useAuth } from '../auth/AuthContext';
import { getMisModulos } from './queries/permisos-modulos';

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./queries/permisos-modulos', () => ({ getMisModulos: vi.fn() }));

const authMock = useAuth as unknown as ReturnType<typeof vi.fn>;
const misModulosMock = getMisModulos as unknown as ReturnType<typeof vi.fn>;

function conRoles(roles: string[], id = 'u1') {
  authMock.mockReturnValue({ user: { id, roles } });
}

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useModulos(), { wrapper });
}

describe('useModulos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('el administrador ve todo y no consulta al servidor', () => {
    conRoles(['ADMINISTRADOR']);
    const { result } = render();
    expect(result.current.puedeVer('alertas')).toBe(true);
    expect(result.current.puedeVer('powerbi-cdas')).toBe(true);
    expect(misModulosMock).not.toHaveBeenCalled();
  });

  it('usa lo configurado y descarta ids que la web no conoce', async () => {
    conRoles(['LECTOR']);
    misModulosMock.mockResolvedValue({ modulos: ['kits', 'modulo-viejo'] });
    const { result } = render();
    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect([...result.current.visibles]).toEqual(['kits']);
    expect(result.current.puedeVer('inicio')).toBe(false);
  });

  it('mientras carga usa la visibilidad de fábrica (el menú no desaparece)', () => {
    conRoles(['ASISTENTE_TRANSVERSAL']);
    misModulosMock.mockReturnValue(new Promise(() => {}));
    const { result } = render();
    expect(result.current.cargando).toBe(true);
    expect(result.current.puedeVer('operadores-cda')).toBe(true);
    expect(result.current.puedeVer('kits')).toBe(false);
  });

  it('si el servidor falla o responde algo raro, cae a la visibilidad de fábrica', async () => {
    conRoles(['TECNICO_SUPERVISOR']);
    misModulosMock.mockRejectedValue(new Error('caído'));
    const falla = render();
    await waitFor(() => expect(falla.result.current.cargando).toBe(false));
    expect(falla.result.current.puedeVer('alertas')).toBe(true);

    misModulosMock.mockResolvedValue({ modulos: 'kits' });
    const raro = render();
    await waitFor(() => expect(raro.result.current.cargando).toBe(false));
    expect(raro.result.current.puedeVer('alertas')).toBe(true);
  });

  it('con varios roles, la fábrica es la unión de lo que ve cada uno', () => {
    conRoles(['LECTOR', 'ASISTENTE_TRANSVERSAL']);
    misModulosMock.mockReturnValue(new Promise(() => {}));
    const { result } = render();
    expect(result.current.puedeVer('reportes')).toBe(true);
    expect(result.current.puedeVer('operadores-cda')).toBe(true);
  });
  it('acciones: el administrador puede todo', () => {
    conRoles(['ADMINISTRADOR']);
    const { result } = render();
    expect(result.current.puede('cda.carnets.emitir')).toBe(true);
  });

  it('acciones: usa las que manda el servidor y descarta ids desconocidos', async () => {
    conRoles(['ASISTENTE_TRANSVERSAL']);
    misModulosMock.mockResolvedValue({ modulos: ['operadores-cda'], permisos: ['cda.asistencia.qr', 'cda.inventada'] });
    const { result } = render();
    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(result.current.puede('cda.asistencia.qr')).toBe(true);
    expect(result.current.puede('cda.asistencia.marcar')).toBe(false);
  });

  it('acciones: mientras carga (o con una API vieja sin permisos) usa las de fábrica', async () => {
    conRoles(['ASISTENTE_TRANSVERSAL']);
    misModulosMock.mockReturnValue(new Promise(() => {}));
    const cargando = render();
    expect(cargando.result.current.puede('cda.asistencia.marcar')).toBe(true);
    expect(cargando.result.current.puede('cda.carnets.emitir')).toBe(false);

    misModulosMock.mockResolvedValue({ modulos: ['cadena-custodia'] });
    const vieja = render();
    await waitFor(() => expect(vieja.result.current.cargando).toBe(false));
    // Sin el módulo CDAs, tampoco sus acciones de fábrica.
    expect(vieja.result.current.puede('cda.asistencia.marcar')).toBe(false);
  });
});
