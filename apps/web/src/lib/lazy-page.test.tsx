import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';

import { CargaDePagina } from '../components/CargaDePagina';
import { CLAVE_RECARGA_CHUNK, VENTANA_RECARGA_MS, lazyPage } from './lazy-page';

describe('lazyPage', () => {
  const reload = vi.fn();
  const locationOriginal = window.location;

  beforeEach(() => {
    sessionStorage.clear();
    reload.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...locationOriginal, reload } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: locationOriginal });
    vi.restoreAllMocks();
  });

  it('muestra el indicador y luego la página con su export con nombre', async () => {
    const Pagina = lazyPage(() => Promise.resolve({ Pagina: () => <p>contenido</p> }), 'Pagina');
    render(
      <CargaDePagina>
        <Pagina />
      </CargaDePagina>,
    );
    expect(await screen.findByText('contenido')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it('si el chunk no existe (deploy nuevo), recarga una sola vez', async () => {
    const Pagina = lazyPage(() => Promise.reject(new Error('Failed to fetch dynamically imported module')), 'Pagina');
    render(
      <CargaDePagina>
        <Pagina />
      </CargaDePagina>,
    );
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(Number(sessionStorage.getItem(CLAVE_RECARGA_CHUNK))).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('si ya recargó hace menos de 10 s y vuelve a fallar, muestra el aviso de conexión (sin bucle)', async () => {
    sessionStorage.setItem(CLAVE_RECARGA_CHUNK, String(Date.now()));
    const Pagina = lazyPage(() => Promise.reject(new Error('sin red')), 'Pagina');
    render(
      <CargaDePagina>
        <Pagina />
      </CargaDePagina>,
    );
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Revise su conexión');
    expect(aviso).toHaveFocus();
    expect(reload).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Recargar' }).click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('pasada la ventana de 10 s, un nuevo deploy vuelve a recargar', async () => {
    sessionStorage.setItem(CLAVE_RECARGA_CHUNK, String(Date.now() - VENTANA_RECARGA_MS - 1));
    const Pagina = lazyPage(() => Promise.reject(new Error('chunk viejo')), 'Pagina');
    render(
      <CargaDePagina>
        <Pagina />
      </CargaDePagina>,
    );
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('sin sessionStorage no recarga (evita un bucle) y muestra el aviso', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const Pagina = lazyPage(() => Promise.reject(new Error('sin red')), 'Pagina');
    render(
      <CargaDePagina>
        <Pagina />
      </CargaDePagina>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Revise su conexión');
    expect(reload).not.toHaveBeenCalled();
  });

  it('un error de la página (no de descarga) muestra un mensaje genérico', async () => {
    const Rota = () => {
      throw new TypeError('x is undefined');
    };
    const Pagina = lazyPage(() => Promise.resolve({ Pagina: Rota }), 'Pagina');
    render(
      <CargaDePagina>
        <Pagina />
      </CargaDePagina>,
    );
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Ocurrió un error al mostrar esta sección');
    expect(aviso).not.toHaveTextContent('conexión');
  });

  it('al cambiar la clave (otra ruta), se descarta el aviso y se muestra la nueva página', async () => {
    sessionStorage.setItem(CLAVE_RECARGA_CHUNK, String(Date.now()));
    const Rota = lazyPage(() => Promise.reject(new Error('sin red')), 'Pagina');
    const Buena = lazyPage(() => Promise.resolve({ Pagina: () => <p>otra sección</p> }), 'Pagina');
    function Navegacion() {
      const [ruta, setRuta] = useState('/kits');
      return (
        <>
          <button type="button" onClick={() => setRuta('/eventos')}>
            ir a eventos
          </button>
          <CargaDePagina claveReinicio={ruta}>{ruta === '/kits' ? <Rota /> : <Buena />}</CargaDePagina>
        </>
      );
    }
    render(<Navegacion />);
    await screen.findByRole('alert');
    screen.getByRole('button', { name: 'ir a eventos' }).click();
    expect(await screen.findByText('otra sección')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mientras descarga, anuncia "Cargando…" en una región de estado', async () => {
    const Pagina = lazyPage(() => new Promise<{ Pagina: () => JSX.Element }>(() => {}), 'Pagina');
    render(
      <CargaDePagina>
        <Pagina />
      </CargaDePagina>,
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Cargando…');
  });
});
