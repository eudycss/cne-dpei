// Roles cuyos módulos y acciones el administrador configura en "Módulos por rol".
// Archivo aparte para que modulos.ts y permisos.ts lo usen sin importarse en círculo.
export const ROLES_CONFIGURABLES = ['TECNICO_SUPERVISOR', 'LECTOR', 'ASISTENTE_TRANSVERSAL', 'ANALISTA_PROVINCIAL'] as const;
export type RolConfigurable = (typeof ROLES_CONFIGURABLES)[number];
