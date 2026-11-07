import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EstadoIntentoSimulador, IngresoSimuladorResponse } from '@cne/shared-types';

import { SESION_PERDIDA, SimuladorPublicoPage } from './SimuladorPublicoPage';
import { apiPublico } from '../../lib/api';

vi.mock('../../lib/api', () => ({ apiPublico: { post: vi.fn() } }));
const postMock = apiPublico.post as unknown as ReturnType<typeof vi.fn>;

const CEDULA = '1710034065';
const TOKEN = 'k'.repeat(43);

const INGRESO: IngresoSimuladorResponse = {
  nombre: 'C. H. J. G.',
  cargo: 'Digitadores',
  practicas: [
    { id: 'p1', nombre: 'Simulacro 1', metaActas: 200, plazoMinutos: 60, filasPorActa: 12, fin: '2026-11-10T23:00:00.000Z', intentosUsados: 0, intentosMax: 2, enCurso: false },
    { id: 'p2', nombre: 'Simulacro 2', metaActas: 100, plazoMinutos: 30, filasPorActa: 8, fin: '2026-11-10T23:00:00.000Z', intentosUsados: 1, intentosMax: 1, enCurso: false },
    { id: 'p3', nombre: 'Simulacro 3', metaActas: 50, plazoMinutos: 20, filasPorActa: 5, fin: '2026-11-10T23:00:00.000Z', intentosUsados: 1, intentosMax: 1, enCurso: true },
  ],
};

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
  iniciadoEn: new Date().toISOString(),
  venceEn: new Date(Date.now() + 3600_000).toISOString(),
  terminado: false,
  motivo: null,
  segundosUsados: null,
  actasFaltantes: 0,
  ...o,
});

function renderPagina() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <SimuladorPublicoPage />
    </QueryClientProvider>,
  );
}

describe('SimuladorPublicoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    postMock.mockImplementation((url: string) => {
      if (url.endsWith('/ingresar')) return Promise.resolve({ data: INGRESO });
      if (url.endsWith('/iniciar')) return Promise.resolve({ data: { token: TOKEN, estado: estado() } });
      if (url.endsWith('/estado')) return Promise.resolve({ data: estado() });
      return Promise.reject(new Error(url));
    });
  });

  it('página privada: fuera de buscadores y sin Referer', () => {
    renderPagina();
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    expect(screen.getByText('Práctica · no es el SIER')).toBeInTheDocument();
  });

  it('cédula inválida: no consulta, muestra el error y mantiene el foco', async () => {
    const user = userEvent.setup();
    renderPagina();
    const campo = screen.getByLabelText('Número de cédula');
    await user.type(campo, '17100340AB66');
    expect(campo).toHaveValue('1710034066');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(postMock).not.toHaveBeenCalled();
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Cédula ecuatoriana inválida');
  });

  it('sin prácticas: el mensaje de la API', async () => {
    const user = userEvent.setup();
    postMock.mockRejectedValue({ response: { status: 404, data: { message: 'No hay prácticas disponibles para esta cédula' } } });
    renderPagina();
    await user.type(screen.getByLabelText('Número de cédula'), CEDULA);
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay prácticas disponibles para esta cédula');
  });

  it('lista las prácticas: empezar, sin intentos o continuar', async () => {
    const user = userEvent.setup();
    renderPagina();
    await user.type(screen.getByLabelText('Número de cédula'), CEDULA);
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByText('C. H. J. G. · Digitadores')).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledWith('/publico/simulador/ingresar', { cedula: CEDULA });
    expect(screen.getByRole('button', { name: 'Empezar intento 1' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sin intentos' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('al empezar guarda el token solo en esta pestaña y abre la digitación', async () => {
    const user = userEvent.setup();
    renderPagina();
    await user.type(screen.getByLabelText('Número de cédula'), CEDULA);
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    await user.click(await screen.findByRole('button', { name: 'Empezar intento 1' }));
    expect(await screen.findByRole('button', { name: 'Nueva acta' })).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledWith('/publico/simulador/iniciar', { cedula: CEDULA, practicaId: 'p1' });
    expect(sessionStorage.getItem('cne.simulador.token')).toBe(TOKEN);
    expect(localStorage.getItem('cne.simulador.token')).toBeNull();
  });

  it('abierta en otro equipo: muestra el aviso y no entra', async () => {
    const user = userEvent.setup();
    postMock.mockImplementation((url: string) =>
      url.endsWith('/ingresar')
        ? Promise.resolve({ data: INGRESO })
        : Promise.reject({ response: { status: 409, data: { message: 'Su práctica está abierta en otro equipo.' } } }),
    );
    renderPagina();
    await user.type(screen.getByLabelText('Número de cédula'), CEDULA);
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    await user.click(await screen.findByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Su práctica está abierta en otro equipo.');
    expect(sessionStorage.getItem('cne.simulador.token')).toBeNull();
  });

  it('al recargar con token, retoma la práctica', async () => {
    sessionStorage.setItem('cne.simulador.token', TOKEN);
    renderPagina();
    expect(screen.getByRole('status')).toHaveTextContent('Recuperando su práctica');
    expect(await screen.findByRole('button', { name: 'Nueva acta' })).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledWith('/publico/simulador/estado', { token: TOKEN });
  });

  it('al recargar sin conexión NO borra el token: permite reintentar', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem('cne.simulador.token', TOKEN);
    postMock.mockRejectedValueOnce(new Error('Network Error'));
    renderPagina();
    const titulo = await screen.findByRole('heading', { name: 'No se pudo recuperar su práctica' });
    await waitFor(() => expect(titulo).toHaveFocus());
    expect(sessionStorage.getItem('cne.simulador.token')).toBe(TOKEN);
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: 'Nueva acta' })).toBeInTheDocument();
  });

  it('al pasar a la lista de prácticas, el foco va a su título', async () => {
    const user = userEvent.setup();
    renderPagina();
    await user.type(screen.getByLabelText('Número de cédula'), CEDULA);
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    const titulo = await screen.findByRole('heading', { name: 'Prácticas disponibles' });
    await waitFor(() => expect(titulo).toHaveFocus());
  });

  it('al recargar con un token que ya no sirve, vuelve al ingreso y lo borra', async () => {
    sessionStorage.setItem('cne.simulador.token', TOKEN);
    postMock.mockRejectedValue({ response: { status: 401 } });
    renderPagina();
    expect(await screen.findByLabelText('Número de cédula')).toBeInTheDocument();
    expect(sessionStorage.getItem('cne.simulador.token')).toBeNull();
  });

  it('práctica terminada al recargar: muestra el resumen', async () => {
    sessionStorage.setItem('cne.simulador.token', TOKEN);
    postMock.mockResolvedValue({
      data: estado({
        terminado: true,
        motivo: 'TIEMPO',
        completadas: 120,
        perfectas: 100,
        filasDigitadas: 965,
        filasCorrectas: 940,
        segundosUsados: 3600,
        actasFaltantes: 80,
      }),
    });
    renderPagina();
    const titulo = await screen.findByRole('heading', { name: 'Se acabó el tiempo' });
    await waitFor(() => expect(titulo).toHaveFocus());
    const cifra = (dt: string) => screen.getByText(dt).nextElementSibling?.textContent;
    expect(cifra('Registros digitados')).toBe('965');
    expect(cifra('Registros correctos')).toBe('940');
    expect(cifra('Registros con error')).toBe('25');
    expect(cifra('Actas digitadas')).toBe('120 de 200');
    expect(cifra('Con algún error')).toBe('20');
    expect(screen.getByText(/Tiempo usado:/)).toHaveTextContent('Tiempo usado: 60:00 · faltaron 80 actas para la meta');
    expect(sessionStorage.getItem('cne.simulador.token')).toBeNull();
  });

  it('cumplió la meta: muestra en cuánto tiempo', async () => {
    sessionStorage.setItem('cne.simulador.token', TOKEN);
    postMock.mockResolvedValue({ data: estado({ terminado: true, motivo: 'META', completadas: 200, segundosUsados: 1104 }) });
    renderPagina();
    await screen.findByRole('heading', { name: 'Cumplió la meta' });
    expect(screen.getByText(/Cumplió la meta en/)).toHaveTextContent('Cumplió la meta en 18:24');
    expect(screen.queryByText(/faltaron|faltó/)).not.toBeInTheDocument();
  });

  it('el aviso de sesión perdida existe para el ingreso', () => {
    expect(SESION_PERDIDA).toMatch(/otro equipo/);
  });
});
