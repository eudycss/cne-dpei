import { AxiosError, AxiosHeaders } from 'axios';
import { MENSAJE_GPS_NO_DISPONIBLE, MENSAJE_SIN_CONEXION, mensajeErrorRegistro } from './mensaje-error-registro';

const GENERICO = 'No se pudo registrar la salida. Intenta de nuevo.';

function errorHttp(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  });
}

describe('mensajeErrorRegistro', () => {
  it('GPS sin fix: pide acercarse a una ventana o salir al exterior', () => {
    const gps = new Error('No se pudo obtener la ubicación a tiempo');
    gps.name = 'UbicacionNoDisponibleError';
    expect(mensajeErrorRegistro(gps, GENERICO)).toBe(MENSAJE_GPS_NO_DISPONIBLE);
  });

  it('sin respuesta del servidor: avisa que no hay conexión', () => {
    expect(mensajeErrorRegistro(new AxiosError('Network Error', 'ERR_NETWORK'), GENERICO)).toBe(MENSAJE_SIN_CONEXION);
  });

  it('con mensaje del servidor: lo muestra tal cual', () => {
    expect(mensajeErrorRegistro(errorHttp(400, { message: 'Debes registrar la llegada' }), GENERICO)).toBe(
      'Debes registrar la llegada',
    );
  });

  it('error del servidor sin mensaje u otro error: usa el genérico de la pantalla', () => {
    expect(mensajeErrorRegistro(errorHttp(500, {}), GENERICO)).toBe(GENERICO);
    expect(mensajeErrorRegistro(new Error('raro'), GENERICO)).toBe(GENERICO);
  });
});
