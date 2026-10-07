import type { RoleName } from '@cne/shared-types';

const ETIQUETAS_ROL: Record<RoleName, string> = {
  ADMINISTRADOR: 'Administrador',
  TECNICO_SUPERVISOR: 'Técnico supervisor',
  OPERADOR_CDA: 'Operador CDA',
  LECTOR: 'Lector',
  ASISTENTE_TRANSVERSAL: 'Asistente Electoral Transversal',
};

/** El asistente transversal solo usa la cadena de custodia en la web. */
export function esSoloAsistente(roles: readonly RoleName[] | undefined): boolean {
  return !!roles?.length && roles.every((r) => r === 'ASISTENTE_TRANSVERSAL');
}

/** Nombre legible del rol; si llega uno desconocido se muestra tal cual. */
export function etiquetaRol(rol: string): string {
  return ETIQUETAS_ROL[rol as RoleName] ?? rol;
}
