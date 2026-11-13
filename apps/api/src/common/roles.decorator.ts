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
