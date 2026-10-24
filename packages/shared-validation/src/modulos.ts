import { z } from 'zod';

// Módulos de la web que el administrador puede mostrar u ocultar por rol.
// El ADMINISTRADOR siempre ve todos; OPERADOR_CDA no entra a la web.
export const ROLES_CONFIGURABLES = ['TECNICO_SUPERVISOR', 'LECTOR', 'ASISTENTE_TRANSVERSAL'] as const;
export type RolConfigurable = (typeof ROLES_CONFIGURABLES)[number];

export const MODULO_WEB_IDS = [
  'inicio',
  'recintos',
  'usuarios',
  'militares',
  'eventos',
  'asignaciones',
  'kits',
  'monitoreo',
  'incidencias',
  'alertas',
  'operadores-cda',
  'cadena-custodia',
  'reportes',
  'powerbi-cdas',
] as const;
export type ModuloWebId = (typeof MODULO_WEB_IDS)[number];

export type SeccionModulo = 'Preparación' | 'Operación' | 'Personal' | 'Informes';

export interface ModuloWeb {
  id: ModuloWebId;
  etiqueta: string;
  seccion: SeccionModulo;
  ruta: string;
  /**
   * Techo: roles a los que el API ya les permite leer los datos del módulo
   * (sus `@Roles`). Activarlo para otro rol solo daría una página con 403.
   */
  rolesPermitidos: readonly RolConfigurable[];
  /** Visibilidad de fábrica (la que había antes de que fuera configurable). */
  rolesPorDefecto: readonly RolConfigurable[];
}

const TEC_LEC = ['TECNICO_SUPERVISOR', 'LECTOR'] as const;

export const MODULOS_WEB: readonly ModuloWeb[] = [
  { id: 'inicio', etiqueta: 'Estado de la preparación', seccion: 'Preparación', ruta: '/', rolesPermitidos: TEC_LEC, rolesPorDefecto: TEC_LEC },
  { id: 'recintos', etiqueta: 'Recintos Electorales', seccion: 'Preparación', ruta: '/recintos', rolesPermitidos: TEC_LEC, rolesPorDefecto: TEC_LEC },
  { id: 'usuarios', etiqueta: 'Usuarios', seccion: 'Preparación', ruta: '/users', rolesPermitidos: TEC_LEC, rolesPorDefecto: TEC_LEC },
  { id: 'militares', etiqueta: 'Militares', seccion: 'Preparación', ruta: '/militares', rolesPermitidos: TEC_LEC, rolesPorDefecto: TEC_LEC },
  { id: 'eventos', etiqueta: 'Eventos Electorales', seccion: 'Preparación', ruta: '/eventos', rolesPermitidos: TEC_LEC, rolesPorDefecto: TEC_LEC },
  { id: 'asignaciones', etiqueta: 'Asignaciones', seccion: 'Preparación', ruta: '/asignaciones', rolesPermitidos: TEC_LEC, rolesPorDefecto: TEC_LEC },
  { id: 'kits', etiqueta: 'Kits Electorales', seccion: 'Preparación', ruta: '/kits', rolesPermitidos: TEC_LEC, rolesPorDefecto: TEC_LEC },
  { id: 'monitoreo', etiqueta: 'Monitoreo', seccion: 'Operación', ruta: '/operadores', rolesPermitidos: TEC_LEC, rolesPorDefecto: TEC_LEC },
  { id: 'incidencias', etiqueta: 'Incidencias', seccion: 'Operación', ruta: '/incidencias', rolesPermitidos: TEC_LEC, rolesPorDefecto: TEC_LEC },
  { id: 'alertas', etiqueta: 'Alertas', seccion: 'Operación', ruta: '/alertas', rolesPermitidos: ['TECNICO_SUPERVISOR'], rolesPorDefecto: ['TECNICO_SUPERVISOR'] },
  {
    id: 'operadores-cda',
    etiqueta: 'CDAs (Operadores y Asistentes)',
    seccion: 'Personal',
    ruta: '/operadores-cda',
    rolesPermitidos: ['TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL'],
    rolesPorDefecto: ['TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL'],
  },
  {
    id: 'cadena-custodia',
    etiqueta: 'Cadena de custodia',
    seccion: 'Informes',
    ruta: '/reportes/cadena-custodia',
    // El API exige además que el módulo esté activo para el rol (ModuloGuard).
    rolesPermitidos: ROLES_CONFIGURABLES,
    rolesPorDefecto: ['LECTOR', 'ASISTENTE_TRANSVERSAL'],
  },
  { id: 'reportes', etiqueta: 'Reportes', seccion: 'Informes', ruta: '/reportes/no-cda', rolesPermitidos: ['LECTOR'], rolesPorDefecto: ['LECTOR'] },
  // Power BI controla su propio acceso: no consume el API.
  {
    id: 'powerbi-cdas',
    etiqueta: 'Power BI CDAS',
    seccion: 'Informes',
    ruta: '/reportes/cdas',
    rolesPermitidos: ROLES_CONFIGURABLES,
    rolesPorDefecto: TEC_LEC,
  },
];

export function esRolConfigurable(rol: string): rol is RolConfigurable {
  return (ROLES_CONFIGURABLES as readonly string[]).includes(rol);
}

/** Módulos que el rol puede llegar a ver (su techo según el API). */
export function modulosPermitidosParaRol(rol: RolConfigurable): ModuloWebId[] {
  return MODULOS_WEB.filter((m) => m.rolesPermitidos.includes(rol)).map((m) => m.id);
}

/** Visibilidad de fábrica para un conjunto de roles (unión). El admin ve todo. */
export function modulosPorDefecto(roles: readonly string[]): ModuloWebId[] {
  if (roles.includes('ADMINISTRADOR')) return MODULO_WEB_IDS.slice();
  return MODULOS_WEB.filter((m) => m.rolesPorDefecto.some((r) => roles.includes(r))).map((m) => m.id);
}

export const actualizarModulosRolSchema = z.object({
  modulos: z
    .array(z.enum(MODULO_WEB_IDS))
    .max(MODULO_WEB_IDS.length)
    .transform((ids) => Array.from(new Set(ids))),
});
