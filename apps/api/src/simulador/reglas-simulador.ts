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
}

/** Terminó por meta cumplida o porque se acabó el tiempo (aunque nadie lo haya cerrado aún). */
export function motivoCierre(intento: IntentoParaEstado, metaActas: number, ahora: Date): 'META' | 'TIEMPO' | null {
  if (intento.actasCompletadas >= metaActas) return 'META';
  if (intento.terminadoEn || intento.venceEn.getTime() <= ahora.getTime()) return 'TIEMPO';
  return null;
}

export function estadoIntento(
  intento: IntentoParaEstado,
  practica: { nombre: string; metaActas: number },
  persona: { nombre: string; cargo: string },
  ahora: Date,
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
    iniciadoEn: intento.iniciadoEn.toISOString(),
    venceEn: intento.venceEn.toISOString(),
    terminado: motivo !== null,
    motivo,
  };
}
