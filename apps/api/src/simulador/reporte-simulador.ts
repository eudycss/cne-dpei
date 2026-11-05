import { NotFoundException } from '@nestjs/common';
import type {
  EstadoPersonaReporteSimulador,
  FilaReporteSimulador,
  IntentoReporteSimulador,
  ReporteSimulador,
} from '@cne/shared-types';

import { motivoCierre, type IntentoParaEstado, type Parcial } from './reglas-simulador';

/**
 * Reporte del simulador (lógica pura, sin base): resume cada intento, elige el
 * mejor de cada persona y ordena. "Cumplió" = llegó a la meta de actas dentro
 * del tiempo (guardar se rechaza vencido el plazo, así que no hay otra forma).
 */

export interface IntentoParaReporte extends IntentoParaEstado {
  cargo: string;
}

const MINUTO_MS = 60_000;
const unDecimal = (n: number) => Math.round(n * 10) / 10;

export function resumirIntento(
  intento: IntentoParaReporte,
  metaActas: number,
  ahora: Date,
  parcial: Parcial = { digitadas: 0, correctas: 0 },
): IntentoReporteSimulador {
  const motivo = motivoCierre(intento, metaActas, ahora);
  // El acta a medias cuenta solo si se acabó el tiempo (igual que en la pantalla de la persona).
  const extra = motivo === 'TIEMPO' ? parcial : { digitadas: 0, correctas: 0 };
  const digitadas = intento.filasDigitadas + extra.digitadas;
  const correctas = intento.filasCorrectas + extra.correctas;
  // Fin: cuando se cerró (o, cerrado por tiempo sin marca, el vencimiento); en curso, ahora. Nunca pasa del plazo.
  const cierre = motivo === 'TIEMPO' ? (intento.terminadoEn ?? intento.venceEn) : motivo === 'META' ? (intento.terminadoEn ?? ahora) : ahora;
  const fin = Math.min(intento.venceEn.getTime(), cierre.getTime());
  const minutos = Math.max(0, fin - intento.iniciadoEn.getTime()) / MINUTO_MS;
  return {
    numero: intento.numero,
    cargo: intento.cargo,
    iniciadoEn: intento.iniciadoEn.toISOString(),
    terminadoEn: motivo ? new Date(fin).toISOString() : null,
    motivo,
    minutos: unDecimal(minutos),
    filasDigitadas: digitadas,
    filasCorrectas: correctas,
    filasConError: digitadas - correctas,
    registrosPorMinuto: minutos > 0 ? unDecimal(digitadas / minutos) : 0,
    actasCompletadas: intento.actasCompletadas,
    actasPerfectas: intento.actasPerfectas,
    actasConError: intento.actasCompletadas - intento.actasPerfectas,
    cumplio: motivo === 'META',
  };
}

/** Mejor primero: cumplió la meta; luego más registros correctos; luego menos minutos; luego el primero. */
export function compararIntentos(a: IntentoReporteSimulador, b: IntentoReporteSimulador): number {
  return (
    Number(b.cumplio) - Number(a.cumplio) ||
    b.filasCorrectas - a.filasCorrectas ||
    a.minutos - b.minutos ||
    a.numero - b.numero
  );
}

export function mejorIntento(intentos: IntentoReporteSimulador[]): IntentoReporteSimulador | null {
  return intentos.length ? [...intentos].sort(compararIntentos)[0] : null;
}

export interface PersonaParaReporte {
  operadorId: string;
  cedula: string;
  apellidosNombres: string;
  telefono: string | null;
  /** Cargo actual (si no tiene intentos). */
  cargo: string;
  asignada: boolean;
}

export function filaPersona(persona: PersonaParaReporte, intentos: IntentoReporteSimulador[]): FilaReporteSimulador {
  const ordenados = [...intentos].sort((a, b) => a.numero - b.numero);
  const mejor = mejorIntento(ordenados);
  const estado: EstadoPersonaReporteSimulador = !mejor
    ? 'NO_SE_PRESENTO'
    : ordenados.some((i) => i.motivo === null)
      ? 'EN_CURSO'
      : 'TERMINADO';
  return {
    ...persona,
    cargo: mejor?.cargo ?? persona.cargo,
    estado,
    intentos: ordenados,
    mejor: mejor?.numero ?? null,
    cumplio: mejor?.cumplio ?? false,
  };
}

/** El mejor intento de la fila (null si no se presentó). */
export function intentoMejor(f: FilaReporteSimulador): IntentoReporteSimulador | null {
  return f.intentos.find((i) => i.numero === f.mejor) ?? null;
}

/** Quien se presentó, por su mejor intento; al final quien no, por nombre. */
export function ordenarFilas(filas: FilaReporteSimulador[]): FilaReporteSimulador[] {
  return [...filas].sort((a, b) => {
    const ma = intentoMejor(a);
    const mb = intentoMejor(b);
    if (ma && mb) return compararIntentos(ma, mb) || a.apellidosNombres.localeCompare(b.apellidosNombres, 'es');
    if (ma || mb) return ma ? -1 : 1;
    return a.apellidosNombres.localeCompare(b.apellidosNombres, 'es');
  });
}

export function totales(filas: FilaReporteSimulador[]): ReporteSimulador['totales'] {
  return {
    personas: filas.length,
    presentaron: filas.filter((f) => f.estado !== 'NO_SE_PRESENTO').length,
    cumplieron: filas.filter((f) => f.cumplio).length,
    enCurso: filas.filter((f) => f.estado === 'EN_CURSO').length,
    noSePresentaron: filas.filter((f) => f.estado === 'NO_SE_PRESENTO').length,
  };
}

/** La fila de una persona (para su reporte individual). */
export function filaDe(rep: ReporteSimulador, operadorId: string): FilaReporteSimulador {
  const fila = rep.filas.find((f) => f.operadorId === operadorId);
  if (!fila) throw new NotFoundException('Esa persona no está en esta práctica');
  return fila;
}
