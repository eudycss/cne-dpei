import type { ModuloWebId, RolConfigurable } from './modulos';

// Acciones dentro de un módulo que el administrador puede dar o quitar por rol.
// Solo cuentan si el rol además ve el módulo. El ADMINISTRADOR siempre puede todo.
export const PERMISO_IDS = [
  'cda.asistencia.marcar',
  'cda.asistencia.qr',
  'cda.asistencia.exportar',
  'cda.asistencia.corregir',
  'cda.actas.gestionar',
  'cda.fotos.enlace',
  'cda.carnets.emitir',
  'cda.carnets.reimprimir',
  'cda.convocatoria.gestionar',
  'cda.evatics.ver',
  'cda.evatics.revisar',
] as const;
export type PermisoId = (typeof PERMISO_IDS)[number];

export interface PermisoAccion {
  id: PermisoId;
  modulo: ModuloWebId;
  etiqueta: string;
  /** Techo: roles a los que se les puede dar (el API los deja pasar por @Roles). */
  rolesPermitidos: readonly RolConfigurable[];
  /** De fábrica: lo que cada rol ya podía hacer antes de que fuera configurable. */
  rolesPorDefecto: readonly RolConfigurable[];
}

const TEC_AET = ['TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL'] as const;

const PERMISOS_BASE: readonly PermisoAccion[] = [
  { id: 'cda.asistencia.marcar', modulo: 'operadores-cda', etiqueta: 'Marcar o quitar asistencia a mano', rolesPermitidos: TEC_AET, rolesPorDefecto: TEC_AET },
  { id: 'cda.asistencia.qr', modulo: 'operadores-cda', etiqueta: 'Marcar asistencia escaneando el carnet', rolesPermitidos: TEC_AET, rolesPorDefecto: TEC_AET },
  { id: 'cda.asistencia.exportar', modulo: 'operadores-cda', etiqueta: 'Exportar asistencia y atrasos', rolesPermitidos: TEC_AET, rolesPorDefecto: TEC_AET },
  // Cambia la historia: de fábrica solo el administrador, y al Asistente Transversal no se le puede dar.
  { id: 'cda.asistencia.corregir', modulo: 'operadores-cda', etiqueta: 'Corregir la asistencia de días pasados (con motivo)', rolesPermitidos: ['TECNICO_SUPERVISOR'], rolesPorDefecto: [] },
  { id: 'cda.actas.gestionar', modulo: 'operadores-cda', etiqueta: 'Generar, descargar y marcar firmadas las actas', rolesPermitidos: TEC_AET, rolesPorDefecto: TEC_AET },
  { id: 'cda.fotos.enlace', modulo: 'operadores-cda', etiqueta: 'Crear enlaces para subir fotos', rolesPermitidos: TEC_AET, rolesPorDefecto: TEC_AET },
  // Emitir un carnet anula el anterior: de fábrica, solo el administrador.
  { id: 'cda.carnets.emitir', modulo: 'operadores-cda', etiqueta: 'Emitir o anular carnets QR', rolesPermitidos: TEC_AET, rolesPorDefecto: [] },
  // Reimprimir no anula: el mismo código queda en dos papeles. De fábrica, solo el administrador.
  { id: 'cda.carnets.reimprimir', modulo: 'operadores-cda', etiqueta: 'Reimprimir carnets QR vigentes (sin anularlos)', rolesPermitidos: TEC_AET, rolesPorDefecto: [] },
  // Decide quién tiene falta: de fábrica, solo el administrador.
  { id: 'cda.convocatoria.gestionar', modulo: 'operadores-cda', etiqueta: 'Gestionar la convocatoria del día (a quién se llamó)', rolesPermitidos: TEC_AET, rolesPorDefecto: [] },
  // Ver la foto del certificado Evatics, sin poder decidir: de fábrica, los técnicos supervisores.
  { id: 'cda.evatics.ver', modulo: 'operadores-cda', etiqueta: 'Ver las fotos de los certificados Evatics (solo ver)', rolesPermitidos: TEC_AET, rolesPorDefecto: ['TECNICO_SUPERVISOR'] },
  // Aprobar o rechazar: de fábrica, los técnicos supervisores. A Asistentes y Analistas solo los revisa el administrador.
  { id: 'cda.evatics.revisar', modulo: 'operadores-cda', etiqueta: 'Aprobar o rechazar certificados Evatics', rolesPermitidos: TEC_AET, rolesPorDefecto: ['TECNICO_SUPERVISOR'] },
];

/** Al analista provincial se le puede dar cualquier acción, y de fábrica las tiene todas. */
const conAnalista = (roles: readonly RolConfigurable[]): RolConfigurable[] => Array.from(new Set([...roles, 'ANALISTA_PROVINCIAL' as const]));

export const PERMISOS: readonly PermisoAccion[] = PERMISOS_BASE.map((p) => ({
  ...p,
  rolesPermitidos: conAnalista(p.rolesPermitidos),
  rolesPorDefecto: conAnalista(p.rolesPorDefecto),
}));

export function esPermisoId(v: unknown): v is PermisoId {
  return typeof v === 'string' && (PERMISO_IDS as readonly string[]).includes(v);
}

/** Acciones que se le pueden dar al rol (su techo según el API). */
export function permisosPermitidosParaRol(rol: RolConfigurable): PermisoId[] {
  return PERMISOS.filter((p) => p.rolesPermitidos.includes(rol)).map((p) => p.id);
}

/** Acciones de fábrica para un conjunto de roles (unión). El admin puede todo. */
export function permisosPorDefecto(roles: readonly string[]): PermisoId[] {
  if (roles.includes('ADMINISTRADOR')) return PERMISO_IDS.slice();
  return PERMISOS.filter((p) => p.rolesPorDefecto.some((r) => roles.includes(r))).map((p) => p.id);
}

/** Quita las acciones cuyo módulo no está entre los visibles. */
export function permisosConModulo(permisos: readonly string[], modulos: readonly string[]): PermisoId[] {
  return PERMISOS.filter((p) => permisos.includes(p.id) && modulos.includes(p.modulo)).map((p) => p.id);
}
