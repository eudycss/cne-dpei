import axios from 'axios';
import { isNetworkError } from './errores-red';

export const MENSAJE_GPS_NO_DISPONIBLE =
  'No se pudo obtener su ubicación. Acérquese a una ventana o salga al exterior e intente de nuevo.';
export const MENSAJE_SIN_CONEXION = 'No hay conexión con el servidor. Revise su señal e intente de nuevo.';
export const MENSAJE_SESION_NO_VALIDA =
  'Su sesión no es válida. Vuelva a ingresar con su contraseña actual; la foto queda guardada en el teléfono.';

// Por nombre y no con instanceof: las pantallas (y sus tests, que mockean
// location.ts) no tienen por qué compartir la misma clase.
function esGpsNoDisponible(e: unknown): boolean {
  return e instanceof Error && e.name === 'UbicacionNoDisponibleError';
}

/**
 * Mensaje para el operador cuando falla un registro (llegada, salida, kits).
 * Distingue GPS, red y servidor: con un mensaje genérico no se sabe qué
 * falló ni qué hacer (caso salida del DPI, simulacro 2026-11-01).
 */
export function mensajeErrorRegistro(e: unknown, generico: string): string {
  if (esGpsNoDisponible(e)) return MENSAJE_GPS_NO_DISPONIBLE;
  if (isNetworkError(e)) return MENSAJE_SIN_CONEXION;
  if (axios.isAxiosError(e)) {
    const mensaje = (e.response?.data as { message?: unknown } | undefined)?.message;
    if (typeof mensaje === 'string' && mensaje) return mensaje;
  }
  return generico;
}
