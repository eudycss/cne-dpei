jest.mock('../lib/queries/incidencias', () => ({
  misIncidencias: jest.fn(),
  reportarIncidencia: jest.fn(),
}));
jest.mock('../lib/location', () => ({ obtenerUbicacionPuntual: jest.fn() }));
jest.mock('./CameraFoto', () => ({ CameraFoto: () => null }));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import { mensajeErrorIncidencia } from './ReportarIncidenciaModal';

describe('mensajeErrorIncidencia', () => {
  it('traduce el 413 del servidor (foto demasiado grande) al español', () => {
    const msg = mensajeErrorIncidencia({
      response: { status: 413, data: { message: 'request entity too large' } },
    });
    expect(msg).toBe('La foto es demasiado grande para enviarla. Toma otra foto e intenta de nuevo.');
  });

  it('usa el mensaje del servidor en otros errores', () => {
    const msg = mensajeErrorIncidencia({
      response: { status: 404, data: { message: 'No hay un evento electoral activo' } },
    });
    expect(msg).toBe('No hay un evento electoral activo');
  });

  it('usa un mensaje genérico si no hay respuesta', () => {
    expect(mensajeErrorIncidencia(new Error('Network Error'))).toBe(
      'No se pudo reportar la incidencia. Intenta de nuevo.',
    );
  });
});
