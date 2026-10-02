import type { RoleName } from '@cne/shared-types';

const ETIQUETAS_ROL: Record<RoleName, string> = {
  ADMINISTRADOR: 'Administrador',
  TECNICO_SUPERVISOR: 'Técnico supervisor',
  OPERADOR_CDA: 'Operador CDA',
  LECTOR: 'Lector',
};

/** Nombre legible del rol; si llega uno desconocido se muestra tal cual. */
export function etiquetaRol(rol: string): string {
  return ETIQUETAS_ROL[rol as RoleName] ?? rol;
}
