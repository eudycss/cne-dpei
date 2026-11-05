import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActaSimulador, EstadoIntentoSimulador } from '@cne/shared-types';

import { atajo, BORRADOR_MS, LATIDO_MS, PantallaDigitacion } from './PantallaDigitacion';
import { apiPublico } from '../../lib/api';

vi.mock('../../lib/api', () => ({ apiPublico: { post: vi.fn() } }));
const postMock = apiPublico.post as unknown as ReturnType<typeof vi.fn>;

const TOKEN = 't'.repeat(43);
const estado = (o: Partial<EstadoIntentoSimulador> = {}): EstadoIntentoSimulador => ({
  practica: 'Simulacro 1',
  nombre: 'C. H. J. G.',
  cargo: 'Digitadores',
  numeroIntento: 1,
  metaActas: 200,
  completadas: 0,
  perfectas: 0,
  filasDigitadas: 0,
  filasCorrectas: 0,
  iniciadoEn: new Date(Date.now() - 60_000).toISOString(),
  venceEn: new Date(Date.now() + 59 * 60_000).toISOString(),
  terminado: false,
  motivo: null,
  ...o,
});
const ACTA: ActaSimulador = {
  id: '22222222-2222-4222-8222-222222222222',
  numero: 1,
  filas: [
    { letras: 'Sesenta y dos', digitos: '062' },
    { letras: 'Cero', digitos: '000' },
    { letras: 'Cincuenta', digitos: '051' },
  ],
};

/** Respuestas por ruta; `guardar` se puede cambiar en cada prueba. */
let respuestaGuardar: unknown;
function responder() {
  postMock.mockImplementation((url: string) => {
    if (url.endsWith('/nueva-acta')) return Promise.resolve({ data: { estado: estado(), acta: ACTA } });
    if (url.endsWith('/guardar')) return respuestaGuardar instanceof Error || (respuestaGuardar as { response?: unknown })?.response ? Promise.reject(respuestaGuardar) : Promise.resolve({ data: respuestaGuardar });
    if (url.endsWith('/estado')) return Promise.resolve({ data: estado() });
    if (url.endsWith('/borrador')) return Promise.resolve({ data: { guardado: true } });
    return Promise.reject(new Error(url));
  });
}

const llamadas = (ruta: string) => postMock.mock.calls.filter(([u]) => String(u).endsWith(ruta));

function renderPantalla(inicial = estado()) {
  const onTerminada = vi.fn();
  const onSesionPerdida = vi.fn();
  render(<PantallaDigitacion token={TOKEN} estadoInicial={inicial} onTerminada={onTerminada} onSesionPerdida={onSesionPerdida} />);
  return { onTerminada, onSesionPerdida };
}

describe('PantallaDigitacion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respuestaGuardar = { guardada: true, filasIncorrectas: [], estado: estado({ completadas: 1, perfectas: 1 }), aviso: null };
    responder();
  });

  it('muestra nombre enmascarado, cargo, reloj y avance; las novedades aún no se usan', () => {
    renderPantalla();
    const lateral = screen.getByRole('complementary', { name: 'Su práctica' });
    expect(lateral).toHaveTextContent('C. H. J. G.');
    expect(lateral).toHaveTextContent('Digitadores');
    expect(lateral).toHaveTextContent(/5[89]:\d\d/);
    expect(screen.getByRole('progressbar', { name: 'Avance de la meta' })).toHaveAttribute('aria-valuemax', '200');
    expect(screen.getByRole('button', { name: 'Guardar novedad' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('«Nueva acta» trae las filas en letras y casilleros y enfoca la primera caja', async () => {
    const user = userEvent.setup();
    renderPantalla();
    await user.click(screen.getByRole('button', { name: 'Nueva acta' }));
    const acta = await screen.findByRole('list', { name: 'Acta 1' });
    expect(within(acta).getAllByRole('listitem')).toHaveLength(3);
    // Letras separadas y palabras más separadas, como en el acta escrita a mano.
    expect(acta.textContent).toContain('S e s e n t a   y   d o s');
    const primera = screen.getByLabelText('Fila 1: Sesenta y dos; casilleros 062');
    await waitFor(() => expect(primera).toHaveFocus());
    expect(postMock).toHaveBeenCalledWith('/publico/simulador/nueva-acta', { token: TOKEN });
  });

  it('solo acepta dígitos; Tab pasa de fila, Enter no hace nada y Alt+W envía (vacía = null)', async () => {
    const user = userEvent.setup();
    renderPantalla();
    await user.click(screen.getByRole('button', { name: 'Nueva acta' }));
    const primera = await screen.findByLabelText(/Fila 1:/);
    await user.type(primera, '6a2{Enter}');
    expect(primera).toHaveValue('62');
    expect(primera).toHaveFocus();
    expect(llamadas('/guardar')).toHaveLength(0);
    await user.keyboard('{Tab}{Tab}');
    expect(screen.getByLabelText(/Fila 3:/)).toHaveFocus();
    await user.keyboard('50{Enter}');
    expect(llamadas('/guardar')).toHaveLength(0);
    await user.keyboard('{Alt>}w{/Alt}');
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/publico/simulador/guardar', { token: TOKEN, actaId: ACTA.id, valores: [62, null, 50] }),
    );
  });

  it('Alt+Q pide la nueva acta; con un acta abierta no pide otra', async () => {
    const user = userEvent.setup();
    renderPantalla();
    await user.keyboard('{Alt>}q{/Alt}');
    expect(await screen.findByRole('list', { name: 'Acta 1' })).toBeInTheDocument();
    await user.keyboard('{Alt>}q{/Alt}');
    expect(llamadas('/nueva-acta')).toHaveLength(1);
  });

  it('los botones anuncian sus atajos', () => {
    renderPantalla();
    expect(screen.getByRole('button', { name: 'Nueva acta' })).toHaveAttribute('aria-keyshortcuts', 'Alt+Q');
    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveAttribute('aria-keyshortcuts', 'Alt+W');
  });

  it('muestra los registros digitados y correctos', () => {
    renderPantalla(estado({ filasDigitadas: 96, filasCorrectas: 90 }));
    const lateral = screen.getByRole('complementary', { name: 'Su práctica' });
    expect(lateral).toHaveTextContent('Registros digitados96');
    expect(lateral).toHaveTextContent('Correctos: 90');
  });

  it('con errores marca las filas, lo dice y enfoca la primera para corregir', async () => {
    const user = userEvent.setup();
    respuestaGuardar = { guardada: false, filasIncorrectas: [1, 2], estado: estado(), aviso: null };
    renderPantalla();
    await user.click(screen.getByRole('button', { name: 'Nueva acta' }));
    await user.type(await screen.findByLabelText(/Fila 1:/), '62');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Hay 2 fila\(s\) con error \(2, 3\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Fila 2:/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Fila 3:/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Fila 1:/)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText(/Fila 2:/)).toHaveFocus();
  });

  it('guardada: avisa, deja el foco en «Nueva acta» y cada 20 actas muestra «18 de 20»', async () => {
    const user = userEvent.setup();
    respuestaGuardar = { guardada: true, filasIncorrectas: [], estado: estado({ completadas: 20, perfectas: 18 }), aviso: { perfectas: 18, de: 20 } };
    renderPantalla();
    await user.click(screen.getByRole('button', { name: 'Nueva acta' }));
    await screen.findByLabelText(/Fila 1:/);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    // Un solo anuncio (status) con el aviso de cada 20 actas dentro.
    expect(await screen.findByText(/Acta 1 guardada\. Digitó 18 de 20 actas sin errores\./)).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Acta 1' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nueva acta' })).toHaveFocus());
  });

  it('«Entendido» cierra el aviso de 20 actas y deja el foco en «Nueva acta»', async () => {
    const user = userEvent.setup();
    respuestaGuardar = { guardada: true, filasIncorrectas: [], estado: estado({ completadas: 20 }), aviso: { perfectas: 20, de: 20 } };
    renderPantalla();
    await user.click(screen.getByRole('button', { name: 'Nueva acta' }));
    await screen.findByLabelText(/Fila 1:/);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await user.click(await screen.findByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('button', { name: 'Entendido' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nueva acta' })).toHaveFocus());
  });

  it('al entrar, el foco está en «Nueva acta»', async () => {
    renderPantalla();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nueva acta' })).toHaveFocus());
  });

  it('dos Alt+W seguidos mandan un solo guardado', async () => {
    const user = userEvent.setup();
    let soltar: (v: unknown) => void = () => {};
    postMock.mockImplementation((url: string) => {
      if (url.endsWith('/nueva-acta')) return Promise.resolve({ data: { estado: estado(), acta: ACTA } });
      if (url.endsWith('/guardar')) return new Promise((r) => (soltar = r));
      return Promise.resolve({ data: estado() });
    });
    renderPantalla();
    await user.click(screen.getByRole('button', { name: 'Nueva acta' }));
    await screen.findByLabelText(/Fila 3:/);
    await user.keyboard('{Alt>}ww{/Alt}');
    expect(postMock.mock.calls.filter(([u]) => String(u).endsWith('/guardar'))).toHaveLength(1);
    await act(async () => soltar({ data: { guardada: false, filasIncorrectas: [0], estado: estado(), aviso: null } }));
  });

  it('409 sin terminar (acta guardada en otra pestaña): suelta el acta para pedir otra', async () => {
    const user = userEvent.setup();
    postMock.mockImplementation((url: string) => {
      if (url.endsWith('/nueva-acta')) return Promise.resolve({ data: { estado: estado(), acta: ACTA } });
      if (url.endsWith('/guardar')) return Promise.reject({ response: { status: 409, data: { message: 'Esta acta ya se guardó; pida una nueva' } } });
      return Promise.resolve({ data: estado({ completadas: 1 }) });
    });
    renderPantalla();
    await user.click(screen.getByRole('button', { name: 'Nueva acta' }));
    await screen.findByLabelText(/Fila 1:/);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Esta acta ya se guardó; pida una nueva\. Pulse «Nueva acta»/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Acta 1' })).not.toBeInTheDocument();
    const nueva = screen.getByRole('button', { name: 'Nueva acta' });
    expect(nueva).toBeEnabled();
    await waitFor(() => expect(nueva).toHaveFocus());
  });

  it('error de red al guardar: lo dice, conserva lo digitado y devuelve el foco a la caja', async () => {
    const user = userEvent.setup();
    respuestaGuardar = { response: { status: 500, data: {} } };
    renderPantalla();
    await user.click(screen.getByRole('button', { name: 'Nueva acta' }));
    const primera = await screen.findByLabelText(/Fila 1:/);
    await user.type(primera, '62');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('No se pudo guardar el acta. Intente de nuevo.')).toBeInTheDocument();
    expect(primera).toHaveValue('62');
    await waitFor(() => expect(primera).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
  });

  it('una fila con error se describe como «Revisar esta fila»', async () => {
    const user = userEvent.setup();
    respuestaGuardar = { guardada: false, filasIncorrectas: [0], estado: estado(), aviso: null };
    renderPantalla();
    await user.click(screen.getByRole('button', { name: 'Nueva acta' }));
    await screen.findByLabelText(/Fila 1:/);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.getByLabelText(/Fila 1:/)).toHaveAccessibleDescription('Revisar esta fila'));
  });

  it('avisa cuando quedan menos de 5 minutos', () => {
    renderPantalla(estado({ venceEn: new Date(Date.now() + 4 * 60_000).toISOString() }));
    expect(screen.getAllByText('Quedan menos de 5 minutos.').length).toBeGreaterThan(0);
  });

  it('al cumplir la meta termina', async () => {
    const user = userEvent.setup();
    const fin = estado({ completadas: 200, terminado: true, motivo: 'META' });
    respuestaGuardar = { guardada: true, filasIncorrectas: [], estado: fin, aviso: null };
    const { onTerminada } = renderPantalla();
    await user.click(screen.getByRole('button', { name: 'Nueva acta' }));
    await screen.findByLabelText(/Fila 1:/);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onTerminada).toHaveBeenCalledWith(fin));
  });

  it('401 (sesión abierta en otro equipo): sale a la pantalla de ingreso', async () => {
    const user = userEvent.setup();
    respuestaGuardar = { response: { status: 401, data: { message: 'x' } } };
    const { onSesionPerdida } = renderPantalla();
    await user.click(screen.getByRole('button', { name: 'Nueva acta' }));
    await screen.findByLabelText(/Fila 1:/);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onSesionPerdida).toHaveBeenCalled());
  });

  it('409 al guardar porque se acabó el tiempo: consulta el estado y termina', async () => {
    const user = userEvent.setup();
    const fin = estado({ terminado: true, motivo: 'TIEMPO' });
    respuestaGuardar = { response: { status: 409, data: { message: 'La práctica ya terminó' } } };
    postMock.mockImplementation((url: string) => {
      if (url.endsWith('/nueva-acta')) return Promise.resolve({ data: { estado: estado(), acta: ACTA } });
      if (url.endsWith('/guardar')) return Promise.reject(respuestaGuardar);
      return Promise.resolve({ data: fin });
    });
    const { onTerminada } = renderPantalla();
    await user.click(screen.getByRole('button', { name: 'Nueva acta' }));
    await screen.findByLabelText(/Fila 1:/);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onTerminada).toHaveBeenCalledWith(fin));
  });

  describe('con reloj simulado', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('manda un latido periódico para mantener la sesión en uso', async () => {
      renderPantalla();
      expect(postMock).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(LATIDO_MS);
      });
      expect(postMock).toHaveBeenCalledWith('/publico/simulador/estado', { token: TOKEN });
    });

    it('un latido tardío no hace retroceder el avance', async () => {
      postMock.mockResolvedValue({ data: estado({ completadas: 3 }) });
      renderPantalla(estado({ completadas: 5 }));
      await act(async () => {
        vi.advanceTimersByTime(LATIDO_MS);
      });
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
    });

    it('tras una pausa al digitar manda el borrador del acta abierta', async () => {
      responder();
      renderPantalla();
      await act(async () => {
        screen.getByRole('button', { name: 'Nueva acta' }).click();
      });
      const primera = screen.getByLabelText(/Fila 1:/);
      fireEvent.change(primera, { target: { value: '62' } });
      expect(llamadas('/borrador')).toHaveLength(0);
      await act(async () => {
        vi.advanceTimersByTime(BORRADOR_MS);
      });
      expect(postMock).toHaveBeenCalledWith('/publico/simulador/borrador', { token: TOKEN, actaId: ACTA.id, valores: [62, null, null] });
      // Sin cambios no se repite.
      await act(async () => {
        vi.advanceTimersByTime(BORRADOR_MS * 3);
      });
      expect(llamadas('/borrador')).toHaveLength(1);
    });

    it('al llegar a 0 manda primero el borrador y luego cierra (el acta a medias cuenta)', async () => {
      const fin = estado({ terminado: true, motivo: 'TIEMPO', filasDigitadas: 2 });
      const enCurso = estado({ venceEn: new Date(Date.now() + 2000).toISOString() });
      postMock.mockImplementation((url: string) => {
        if (url.endsWith('/nueva-acta')) return Promise.resolve({ data: { estado: enCurso, acta: ACTA } });
        if (url.endsWith('/borrador')) return Promise.resolve({ data: { guardado: true } });
        return Promise.resolve({ data: fin });
      });
      const { onTerminada } = renderPantalla(enCurso);
      await act(async () => {
        screen.getByRole('button', { name: 'Nueva acta' }).click();
      });
      fireEvent.change(screen.getByLabelText(/Fila 1:/), { target: { value: '62' } });
      await act(async () => {
        vi.advanceTimersByTime(2500);
      });
      const rutas = postMock.mock.calls.map(([u]) => String(u).split('/').pop());
      expect(rutas.indexOf('borrador')).toBeGreaterThan(-1);
      expect(rutas.lastIndexOf('estado')).toBeGreaterThan(rutas.indexOf('borrador'));
      expect(onTerminada).toHaveBeenCalledWith(fin);
    });

    it('al llegar a 0 confirma con la API y termina', async () => {
      const fin = estado({ terminado: true, motivo: 'TIEMPO' });
      postMock.mockResolvedValue({ data: fin });
      const { onTerminada } = renderPantalla(estado({ venceEn: new Date(Date.now() + 2000).toISOString() }));
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(onTerminada).toHaveBeenCalledWith(fin);
    });
  });
});

describe('atajo', () => {
  const tecla = (code: string, o: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) => ({
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    code,
    ...o,
  });
  it('Alt+Q y Alt+W, por código de tecla (sirve con cualquier idioma de teclado)', () => {
    expect(atajo(tecla('KeyQ'))).toBe('nueva');
    expect(atajo(tecla('KeyW'))).toBe('guardar');
  });
  it('sin Alt, con Ctrl (AltGr en Windows) o con otra tecla: nada', () => {
    expect(atajo(tecla('KeyQ', { altKey: false }))).toBeNull();
    expect(atajo(tecla('KeyQ', { ctrlKey: true }))).toBeNull();
    expect(atajo(tecla('KeyW', { metaKey: true }))).toBeNull();
    expect(atajo(tecla('KeyE'))).toBeNull();
  });
});
