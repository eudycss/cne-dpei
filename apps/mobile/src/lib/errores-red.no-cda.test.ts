import { AxiosError, AxiosHeaders } from 'axios';
import { esYaRegistrado } from './errores-red';

function conflicto(message: string): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError('409', 'ERR_BAD_REQUEST', { headers }, null, {
    status: 409,
    statusText: 'Conflict',
    headers,
    config: { headers },
    data: { message },
  });
}

/**
 * La cola descarta como "ya estaba" solo los 409 de duplicado. El 409 de un
 * NO CDA marcado después de salir del CDA es un rechazo real: se le avisa al
 * operador (textos de apps/api/src/tracking/tracking.service.ts).
 */
describe('esYaRegistrado con los 409 de llegada NO CDA', () => {
  it('el duplicado sí es "ya registrado"', () => {
    expect(esYaRegistrado(conflicto('Ya registraste la llegada a este NO-CDA'))).toBe(true);
  });

  it('marcar después de la salida NO es "ya registrado"', () => {
    expect(esYaRegistrado(conflicto('Ya registró la salida del CDA: los NO CDA ya no se marcan desde la app.'))).toBe(false);
  });
});
