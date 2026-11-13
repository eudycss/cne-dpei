import { SetMetadata } from '@nestjs/common';
import type { RoleName } from '@cne/shared-types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);

export const SOLO_ADMIN_KEY = 'soloAdministrador';
/**
 * Acción reservada al ADMINISTRADOR: ni el ANALISTA_PROVINCIAL (que de resto
 * actúa como administrador según los módulos que se le activen) puede hacerla.
 * Va junto a @Roles('ADMINISTRADOR'): crear cuentas, repartir roles, configurar permisos.
 */
export const SoloAdmin = () => SetMetadata(SOLO_ADMIN_KEY, true);

export const LECTURA_CONFIGURABLE_KEY = 'lecturaConfigurable';
/**
 * Lectura que un rol configurable (Lector, Técnico, Asistente...) puede recibir al
 * activarle el módulo, aunque el endpoint sea de administrador. Lista blanca: un GET
 * de administrador sin esta marca (informes con datos personales, configuración)
 * sigue siendo solo del administrador y del analista provincial.
 */
export const LecturaConfigurable = () => SetMetadata(LECTURA_CONFIGURABLE_KEY, true);
