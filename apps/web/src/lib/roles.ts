import type { RoleName } from '@cne/shared-types';

const ETIQUETAS_ROL: Record<RoleName, string> = {
  ADMINISTRADOR: 'Administrador',
  TECNICO_SUPERVISOR: 'Técnico supervisor',
  OPERADOR_CDA: 'Operador CDA',
  LECTOR: 'Lector',
  ASISTENTE_TRANSVERSAL: 'Asistente Electoral Transversal',
  ANALISTA_PROVINCIAL: 'Analista provincial',
};

/** El asistente transversal solo usa la cadena de custodia en la web. */
export function esSoloAsistente(roles: readonly RoleName[] | undefined): boolean {
  return !!roles?.length && roles.every((r) => r === 'ASISTENTE_TRANSVERSAL');
}

/** Nombre legible del rol; si llega uno desconocido se muestra tal cual. */
export function etiquetaRol(rol: string): string {
  return ETIQUETAS_ROL[rol as RoleName] ?? rol;
}

/**
 * Administrador, o analista provincial (que actúa como tal en los módulos que el
 * administrador le activa). Solo decide qué botones se muestran: el API revisa todo.
 */
export function actuaComoAdmin(roles: readonly RoleName[] | undefined): boolean {
  return !!roles && (roles.includes('ADMINISTRADOR') || roles.includes('ANALISTA_PROVINCIAL'));
}
