import type { MisModulosResponse, ModulosRol, PermisosModulosResponse } from '@cne/shared-types';
import type { ModuloWebId, RolConfigurable } from '@cne/shared-validation';
import { api } from '../api';

export async function getMisModulos(): Promise<MisModulosResponse> {
  const { data } = await api.get<MisModulosResponse>('/permisos-modulos/mios');
  return data;
}

export async function getPermisosModulos(): Promise<PermisosModulosResponse> {
  const { data } = await api.get<PermisosModulosResponse>('/permisos-modulos');
  return data;
}

export async function guardarModulosRol(rol: RolConfigurable, modulos: ModuloWebId[]): Promise<ModulosRol> {
  const { data } = await api.put<ModulosRol>(`/permisos-modulos/${rol}`, { modulos });
  return data;
}
