import type { ConfigAsistenciaCda, EstadoPuntualidad } from '@cne/shared-types';
import { diaEcuador } from './dia-ecuador';

export const CONFIG_ASISTENCIA_POR_DEFECTO: ConfigAsistenciaCda = { horaEntrada: '08:00', minutosGracia: 10 };

const MINUTO = 60_000;

/** Hora oficial de entrada de ese día. Ecuador continental es UTC-5 todo el año (sin horario de verano). */
export function horaOficial(dia: string, horaEntrada: string): Date {
  return new Date(`${dia}T${horaEntrada}:00-05:00`);
}

/**
 * Puntual hasta el minuto `gracia` inclusive (con 10: 08:10:59 es puntual,
 * 08:11:00 es atraso). El atraso se cuenta desde la hora oficial. Sin entrada
 * es falta, salvo hoy mientras aún no termina la gracia (pendiente).
 */
export function clasificarEntrada(
  entradaEn: Date | null,
  dia: string,
  config: ConfigAsistenciaCda,
  ahora: Date = new Date(),
): { estado: EstadoPuntualidad; minutosAtraso: number } {
  const oficial = horaOficial(dia, config.horaEntrada).getTime();
  if (entradaEn) {
    const minutos = Math.max(0, Math.floor((entradaEn.getTime() - oficial) / MINUTO));
    return minutos > config.minutosGracia
      ? { estado: 'ATRASO', minutosAtraso: minutos }
      : { estado: 'PUNTUAL', minutosAtraso: 0 };
  }
  const aunATiempo = dia === diaEcuador(ahora) && ahora.getTime() < oficial + (config.minutosGracia + 1) * MINUTO;
  return { estado: aunATiempo ? 'PENDIENTE' : 'FALTA', minutosAtraso: 0 };
}
