import { z } from 'zod';
import { PERMISO_IDS } from './permisos';
import { ROLES_CONFIGURABLES, type RolConfigurable } from './roles-configurables';

// Módulos de la web que el administrador puede mostrar u ocultar por rol.
// El ADMINISTRADOR siempre ve todos; OPERADOR_CDA no entra a la web.
// ANALISTA_PROVINCIAL es como el administrador de fábrica (ve y hace todo, salvo lo
// exclusivo del administrador) y el administrador le quita lo que no deba.
export { ROLES_CONFIGURABLES, type RolConfigurable };

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
  'simulador-digitacion',
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
   * Roles a los que el administrador puede dar el módulo: todos los configurables.
   * Quien no es analista lo ve en solo lectura (el API lo trata como administrador solo en GET).
   */
  rolesPermitidos: readonly RolConfigurable[];
  /** Visibilidad de fábrica (la que había antes de que fuera configurable). */
  rolesPorDefecto: readonly RolConfigurable[];
}

const TEC_LEC = ['TECNICO_SUPERVISOR', 'LECTOR'] as const;

const MODULOS_BASE: readonly Omit<ModuloWeb, 'rolesPermitidos'>[] = [
  { id: 'inicio', etiqueta: 'Estado de la preparación', seccion: 'Preparación', ruta: '/', rolesPorDefecto: TEC_LEC },
  { id: 'recintos', etiqueta: 'Recintos Electorales', seccion: 'Preparación', ruta: '/recintos', rolesPorDefecto: TEC_LEC },
  { id: 'usuarios', etiqueta: 'Usuarios', seccion: 'Preparación', ruta: '/users', rolesPorDefecto: TEC_LEC },
  { id: 'militares', etiqueta: 'Militares', seccion: 'Preparación', ruta: '/militares', rolesPorDefecto: TEC_LEC },
  { id: 'eventos', etiqueta: 'Eventos Electorales', seccion: 'Preparación', ruta: '/eventos', rolesPorDefecto: TEC_LEC },
  { id: 'asignaciones', etiqueta: 'Asignaciones', seccion: 'Preparación', ruta: '/asignaciones', rolesPorDefecto: TEC_LEC },
  { id: 'kits', etiqueta: 'Kits Electorales', seccion: 'Preparación', ruta: '/kits', rolesPorDefecto: TEC_LEC },
  { id: 'monitoreo', etiqueta: 'Monitoreo', seccion: 'Operación', ruta: '/operadores', rolesPorDefecto: TEC_LEC },
  { id: 'incidencias', etiqueta: 'Incidencias', seccion: 'Operación', ruta: '/incidencias', rolesPorDefecto: TEC_LEC },
  { id: 'alertas', etiqueta: 'Alertas', seccion: 'Operación', ruta: '/alertas', rolesPorDefecto: ['TECNICO_SUPERVISOR'] },
  {
    id: 'operadores-cda',
    etiqueta: 'CDAs (Operadores y Asistentes)',
    seccion: 'Personal',
    ruta: '/operadores-cda',
    rolesPorDefecto: ['TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL'],
  },
  {
    id: 'simulador-digitacion',
    etiqueta: 'Simulador de digitación',
    seccion: 'Personal',
    ruta: '/simulador-digitacion',
    // De fábrica solo el ADMINISTRADOR; se activa a otros roles en "Módulos por rol".
    rolesPorDefecto: [],
  },
  {
    id: 'cadena-custodia',
    etiqueta: 'Cadena de custodia',
    seccion: 'Informes',
    ruta: '/reportes/cadena-custodia',
    // El API exige además que el módulo esté activo para el rol (ModuloGuard).
    rolesPorDefecto: ['LECTOR', 'ASISTENTE_TRANSVERSAL'],
  },
  { id: 'reportes', etiqueta: 'Reportes', seccion: 'Informes', ruta: '/reportes/no-cda', rolesPorDefecto: ['LECTOR'] },
  // Power BI controla su propio acceso: no consume el API.
  {
    id: 'powerbi-cdas',
    etiqueta: 'Power BI CDAS',
    seccion: 'Informes',
    ruta: '/reportes/cdas',
    rolesPorDefecto: TEC_LEC,
  },
];

/** Al analista provincial se le puede dar cualquier módulo, y de fábrica los ve todos. */
const conAnalista = (roles: readonly RolConfigurable[]): RolConfigurable[] => Array.from(new Set([...roles, 'ANALISTA_PROVINCIAL' as const]));

export const MODULOS_WEB: readonly ModuloWeb[] = MODULOS_BASE.map((m) => ({
  ...m,
  rolesPermitidos: ROLES_CONFIGURABLES,
  rolesPorDefecto: conAnalista(m.rolesPorDefecto),
}));

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
  // Opcional: una web vieja que solo manda módulos no borra las acciones.
  permisos: z
    .array(z.enum(PERMISO_IDS))
    .max(PERMISO_IDS.length)
    .transform((ids) => Array.from(new Set(ids)))
    .optional(),
});
