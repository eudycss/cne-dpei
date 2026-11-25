import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mapa = vi.hoisted(() => ({ flyTo: vi.fn(), getZoom: vi.fn(() => 12) }));
vi.mock('../../components/map', () => ({ useMapInstance: () => mapa }));

import { BuscadorLugar, ZOOM_LUGAR } from './BuscadorLugar';

const COLISEO = { lat: '0.3512', lon: '-78.1234', display_name: 'Coliseo Luis Leoro, Ibarra, Imbabura, Ecuador' };

function responder(datos: unknown) {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(datos) });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('BuscadorLugar', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('con coordenadas va directo, sin consultar a nadie', async () => {
    const fetch = responder([]);
    render(<BuscadorLugar />);
    await userEvent.type(screen.getByLabelText('Lugar o coordenadas'), '0.3485, -78.1189{Enter}');
    expect(fetch).not.toHaveBeenCalled();
    expect(mapa.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-78.1189, 0.3485], zoom: ZOOM_LUGAR }));
    expect(screen.getByRole('status')).toHaveTextContent('Verifique que sea el lugar correcto');
  });

  it('por nombre muestra los resultados y al elegir uno lleva el mapa allí', async () => {
    responder([COLISEO]);
    render(<BuscadorLugar />);
    await userEvent.type(screen.getByRole('searchbox'), 'coliseo');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    const resultado = await screen.findByRole('button', { name: /Coliseo Luis Leoro/ });
    expect(resultado).toHaveTextContent('Ibarra, Imbabura, Ecuador');
    await userEvent.click(resultado);
    expect(mapa.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-78.1234, 0.3512] }));
    expect(screen.queryByRole('button', { name: /Coliseo Luis Leoro/ })).toBeNull();
  });

  it('sin resultados o sin conexión lo dice y sugiere coordenadas', async () => {
    responder([]);
    render(<BuscadorLugar />);
    await userEvent.type(screen.getByRole('searchbox'), 'zzzz{Enter}');
    // Se ve en la lista y además lo anuncia la región de estado.
    expect(await screen.findAllByText(/Sin resultados/)).toHaveLength(2);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findAllByText(/No se pudo buscar/)).toHaveLength(2);
  });

  it('Esc cierra los resultados y devuelve el foco al campo', async () => {
    responder([COLISEO]);
    render(<BuscadorLugar />);
    const campo = screen.getByRole('searchbox');
    await userEvent.type(campo, 'coliseo{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /Coliseo Luis Leoro/ }));
    await userEvent.type(campo, '{Enter}');
    await screen.findByRole('button', { name: /Coliseo Luis Leoro/ });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /Coliseo Luis Leoro/ })).toBeNull();
    expect(campo).toHaveFocus();
  });

  it('el botón Buscar se habilita solo con texto', async () => {
    render(<BuscadorLugar />);
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled();
    await userEvent.type(screen.getByRole('searchbox'), 'a');
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeEnabled();
  });
});
