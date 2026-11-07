import type { EstadoIntentoSimulador } from '@cne/shared-types';

/** Cargos y excepciones de una práctica, tal como salen de la base. */
export interface AsignacionPractica {
  cargos: readonly { cargo: string }[];
  personas: readonly { operadorId: string; incluida: boolean }[];
}

/**
 * ¿La práctica aplica a esta persona? Las excepciones mandan sobre el cargo:
 * "agregada" entra con cualquier cargo; "quitada" no entra aunque su cargo sí.
 */
export function aplicaA(practica: AsignacionPractica, persona: { id: string; grupo: string }): boolean {
  const excepcion = practica.personas.find((p) => p.operadorId === persona.id);
  if (excepcion) return excepcion.incluida;
  return practica.cargos.some((c) => c.cargo === persona.grupo);
}

/**
 * Con solo la cédula no se revela el nombre: solo iniciales ("C. H. J. G.").
 * Basta, con el cargo, para que la persona se reconozca.
 */
export function enmascararNombre(apellidosNombres: string): string {
  return apellidosNombres
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => `${p.charAt(0)}.`)
    .join(' ');
}

export interface IntentoParaEstado {
  numero: number;
  iniciadoEn: Date;
  venceEn: Date;
  terminadoEn: Date | null;
  actasCompletadas: number;
  actasPerfectas: number;
  filasDigitadas: number;
  filasCorrectas: number;
}

/** Registros del acta que quedó a medias al acabarse el tiempo. */
export type Parcial = { digitadas: number; correctas: number };
const SIN_PARCIAL: Parcial = { digitadas: 0, correctas: 0 };

/** Terminó por meta cumplida o porque se acabó el tiempo (aunque nadie lo haya cerrado aún). */
export function motivoCierre(intento: IntentoParaEstado, metaActas: number, ahora: Date): 'META' | 'TIEMPO' | null {
  if (intento.actasCompletadas >= metaActas) return 'META';
  if (intento.terminadoEn || intento.venceEn.getTime() <= ahora.getTime()) return 'TIEMPO';
  return null;
}

/**
 * Hasta cuándo cuenta el tiempo del intento: al cumplir la meta, cuando se
 * cerró (o el vencimiento, si se acabó sin marca) o ahora si sigue abierto.
 * Nunca pasa del plazo. La pantalla de la persona y los reportes usan esto.
 */
export function finDelTiempo(intento: IntentoParaEstado, motivo: 'META' | 'TIEMPO' | null, ahora: Date): Date {
  const cierre = motivo === 'TIEMPO' ? (intento.terminadoEn ?? intento.venceEn) : motivo === 'META' ? (intento.terminadoEn ?? ahora) : ahora;
  return new Date(Math.min(intento.venceEn.getTime(), cierre.getTime()));
}

/** Milisegundos usados del intento (desde que empezó hasta `finDelTiempo`). */
export function msUsados(intento: IntentoParaEstado, motivo: 'META' | 'TIEMPO' | null, ahora: Date): number {
  return Math.max(0, finDelTiempo(intento, motivo, ahora).getTime() - intento.iniciadoEn.getTime());
}

/** Actas que le faltan para la meta (0 si ya la cumplió). */
export const actasFaltantes = (intento: IntentoParaEstado, metaActas: number) => Math.max(0, metaActas - intento.actasCompletadas);

export function estadoIntento(
  intento: IntentoParaEstado,
  practica: { nombre: string; metaActas: number },
  persona: { nombre: string; cargo: string },
  ahora: Date,
  parcial: Parcial = SIN_PARCIAL,
): EstadoIntentoSimulador {
  const motivo = motivoCierre(intento, practica.metaActas, ahora);
  return {
    practica: practica.nombre,
    nombre: persona.nombre,
    cargo: persona.cargo,
    numeroIntento: intento.numero,
    metaActas: practica.metaActas,
    completadas: intento.actasCompletadas,
    perfectas: intento.actasPerfectas,
    filasDigitadas: intento.filasDigitadas + parcial.digitadas,
    filasCorrectas: intento.filasCorrectas + parcial.correctas,
    iniciadoEn: intento.iniciadoEn.toISOString(),
    venceEn: intento.venceEn.toISOString(),
    terminado: motivo !== null,
    motivo,
    segundosUsados: motivo ? Math.floor(msUsados(intento, motivo, ahora) / 1000) : null,
    actasFaltantes: actasFaltantes(intento, practica.metaActas),
  };
}
