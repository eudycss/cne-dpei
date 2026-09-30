import type { MiAsignacionResponse } from '@cne/shared-types';

// Orden de la jornada del operador (HU2 → HU5). LLEGADA y LLEGADA_DPI son las
// pantallas de registro en curso: solo existen en la app, el servidor nunca las devuelve.
const ORDEN = [
  'SALIDA',
  'EN_TRANSITO',
  'LLEGADA',
  'EN_RECINTO',
  'EN_RETORNO',
  'LLEGADA_DPI',
  'RETORNADO',
] as const;

export type OperadorEtapa = (typeof ORDEN)[number];

type RegistrosPrevios = Pick<
  MiAsignacionResponse,
  'yaRegistroSalida' | 'yaRegistroLlegada' | 'yaRegistroSalidaRecinto' | 'yaRegistroLlegadaDpi'
>;

/** Etapa en la que el servidor ubica al operador según lo ya registrado. */
export function etapaDesdeAsignacion(data: RegistrosPrevios): OperadorEtapa {
  if (data.yaRegistroLlegadaDpi) return 'RETORNADO';
  if (data.yaRegistroSalidaRecinto) return 'EN_RETORNO';
  if (data.yaRegistroLlegada) return 'EN_RECINTO';
  if (data.yaRegistroSalida) return 'EN_TRANSITO';
  return 'SALIDA';
}

/**
 * Combina la etapa local con la del servidor sin retroceder nunca: el servidor puede
 * ir adelante (llegada manual del supervisor, otro dispositivo) o atrás (acción aún
 * en la cola offline). En ambos casos gana la más avanzada.
 */
export function etapaMasAvanzada(local: OperadorEtapa | null, servidor: OperadorEtapa): OperadorEtapa {
  if (local === null) return servidor;
  return ORDEN.indexOf(servidor) > ORDEN.indexOf(local) ? servidor : local;
}
