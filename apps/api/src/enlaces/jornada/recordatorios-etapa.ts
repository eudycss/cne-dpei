import type { Jornada, UnidadJornada } from './jornada';

/**
 * Recordatorios en la app (campana de notificaciones) para quien no registró
 * la etapa que le toca: salida de la DPEI, llegada al recinto, prueba de
 * conexión, salida del recinto o llegada a la DPEI. Solo funciones puras; el
 * servicio guarda lo ya avisado y crea las notificaciones.
 */

export type EtapaRecordada = 'SALIDA_DPI' | 'LLEGADA_RECINTO' | 'PRUEBA_CONEXION' | 'SALIDA_RECINTO' | 'LLEGADA_DPI';

/** Minutos de espera desde la etapa anterior (ida y vuelta usan el tiempo de viaje del recinto). */
export const ESPERA_ETAPA_MIN = 30;
/** Cada cuánto se repite el recordatorio mientras la etapa siga pendiente. */
export const REPETIR_CADA_MIN = 30;
/** Tope de recordatorios por etapa: no se insiste toda la jornada. */
export const MAX_RECORDATORIOS = 3;

const MINUTO = 60_000;

/** Texto que muestra la campana de la app (campo tipoEvento, máx. 60 caracteres). */
export const TEXTO_RECORDATORIO: Record<EtapaRecordada, string> = {
  SALIDA_DPI: 'Falta registrar: salida de la DPEI',
  LLEGADA_RECINTO: 'Falta registrar: llegada al recinto',
  PRUEBA_CONEXION: 'Falta registrar: prueba de conexión',
  SALIDA_RECINTO: 'Falta registrar: salida del recinto',
  LLEGADA_DPI: 'Falta registrar: llegada a la DPEI',
};

export interface Recordatorio {
  /** Única por etapa, operador y repetición: el servicio no la envía dos veces. */
  clave: string;
  etapa: EtapaRecordada;
  operadorId: string;
  /** Cuentas (usuario) que reciben el recordatorio. */
  destinatarios: string[];
  /** Cuántos minutos lleva vencida la etapa. */
  minutosVencida: number;
}

/** La siguiente etapa que le falta a la unidad y desde cuándo se le espera; null = nada pendiente o sin dato para saberlo. */
export function etapaPendiente(u: UnidadJornada): { etapa: EtapaRecordada; vence: Date } | null {
  const { registros, pruebaConexion, kitRecibido, tiempoViajeMin } = u;
  const despues = (desde: Date, minutos: number) => new Date(desde.getTime() + minutos * MINUTO);

  if (registros.LLEGADA_DPI) return null;
  if (registros.SALIDA_RECINTO) {
    return tiempoViajeMin === null ? null : { etapa: 'LLEGADA_DPI', vence: despues(registros.SALIDA_RECINTO.en, tiempoViajeMin) };
  }
  if (registros.LLEGADA_RECINTO) {
    if (!pruebaConexion) return { etapa: 'PRUEBA_CONEXION', vence: despues(registros.LLEGADA_RECINTO.en, ESPERA_ETAPA_MIN) };
    // Una prueba marcada antes de la llegada (marcas fuera de orden) no adelanta el aviso.
    const desde = pruebaConexion.en > registros.LLEGADA_RECINTO.en ? pruebaConexion.en : registros.LLEGADA_RECINTO.en;
    return { etapa: 'SALIDA_RECINTO', vence: despues(desde, ESPERA_ETAPA_MIN) };
  }
  if (registros.SALIDA_DPI) {
    return tiempoViajeMin === null ? null : { etapa: 'LLEGADA_RECINTO', vence: despues(registros.SALIDA_DPI.en, tiempoViajeMin) };
  }
  return kitRecibido ? { etapa: 'SALIDA_DPI', vence: despues(kitRecibido, ESPERA_ETAPA_MIN) } : null;
}

/** Los recordatorios que toca enviar ahora (uno por unidad como máximo; los ya enviados se omiten). */
export function recordatoriosEtapa(j: Jornada, ahora: Date, enviados: ReadonlySet<string>): Recordatorio[] {
  const resultado: Recordatorio[] = [];
  for (const u of j.unidades) {
    const pendiente = etapaPendiente(u);
    if (!pendiente || ahora < pendiente.vence) continue;
    const vencida = Math.floor((ahora.getTime() - pendiente.vence.getTime()) / MINUTO);
    // Si el servidor estuvo caído, solo se manda el que corresponde a esta hora, no los atrasados.
    const repeticion = Math.min(Math.floor(vencida / REPETIR_CADA_MIN), MAX_RECORDATORIOS - 1);
    const clave = `ETAPA:${pendiente.etapa}:${u.operadorId}:${repeticion}`;
    if (enviados.has(clave)) continue;
    resultado.push({
      clave,
      etapa: pendiente.etapa,
      operadorId: u.operadorId,
      destinatarios: u.destinatarios?.length ? u.destinatarios : [u.operadorId],
      minutosVencida: vencida,
    });
  }
  return resultado;
}
