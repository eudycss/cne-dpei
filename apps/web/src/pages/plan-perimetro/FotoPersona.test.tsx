import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../lib/api';
import { FotoPersona } from './FotoPersona';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));
const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

function renderFoto(cliente: QueryClient, operadorId: string, nombre: string) {
  return (
    <QueryClientProvider client={cliente}>
      <FotoPersona key={operadorId} planId="pl" operadorId={operadorId} nombre={nombre} />
    </QueryClientProvider>
  );
}

describe('FotoPersona', () => {
  let n = 0;
  beforeEach(() => {
    vi.clearAllMocks();
    n = 0;
    URL.createObjectURL = vi.fn(() => `blob:${++n}`);
    URL.revokeObjectURL = vi.fn();
  });

  it('muestra la foto de la persona y la libera al desmontar', async () => {
    getMock.mockResolvedValue({ data: new Blob(['a']) });
    const cliente = new QueryClient();
    const { unmount } = render(renderFoto(cliente, 'op-a', 'ANA'));
    expect(screen.getByRole('img', { name: 'Cargando foto de ANA' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Foto de ANA' })).toHaveAttribute('src', 'blob:1');
    expect(getMock).toHaveBeenCalledWith('/perimetro/planes/pl/personas/op-a/foto', { responseType: 'blob' });
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });

  it('al cambiar de persona nunca muestra la foto de la anterior mientras carga', async () => {
    let soltarB: (v: unknown) => void = () => {};
    getMock
      .mockResolvedValueOnce({ data: new Blob(['a']) })
      .mockReturnValueOnce(new Promise((r) => (soltarB = r)));
    const cliente = new QueryClient();
    const { rerender } = render(renderFoto(cliente, 'op-a', 'ANA'));
    await screen.findByRole('img', { name: 'Foto de ANA' });

    rerender(renderFoto(cliente, 'op-b', 'BETO'));
    expect(screen.getByRole('img', { name: 'Cargando foto de BETO' })).toBeInTheDocument();
    expect(document.querySelector('img[src="blob:1"]')).toBeNull();

    soltarB({ data: new Blob(['b']) });
    expect(await screen.findByRole('img', { name: 'Foto de BETO' })).toHaveAttribute('src', 'blob:2');
  });

  it('si falla lo dice en el nombre accesible', async () => {
    getMock.mockRejectedValue(new Error('404'));
    render(renderFoto(new QueryClient(), 'op-a', 'ANA'));
    expect(await screen.findByRole('img', { name: 'No se pudo cargar la foto de ANA' })).toBeInTheDocument();
  });
});
