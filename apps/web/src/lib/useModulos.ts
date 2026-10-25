import { useQuery } from '@tanstack/react-query';
import {
  MODULO_WEB_IDS,
  PERMISO_IDS,
  esPermisoId,
  modulosPorDefecto,
  permisosConModulo,
  permisosPorDefecto,
  type ModuloWebId,
  type PermisoId,
} from '@cne/shared-validation';
import { useAuth } from '../auth/AuthContext';
import { getMisModulos } from './queries/permisos-modulos';

export const MIS_MODULOS_KEY = ['mis-modulos'] as const;

function esIdModulo(v: unknown): v is ModuloWebId {
  return typeof v === 'string' && (MODULO_WEB_IDS as readonly string[]).includes(v);
}

/**
 * Módulos de la web que el usuario puede ver y acciones que puede hacer, según
 * lo que configuró el administrador. Mientras carga (o si falla) usa la de fábrica,
 * para no esconder el menú de golpe ni dejar a nadie sin acceso. Las rutas
 * esperan a `cargando` antes de redirigir (ver GuardModulo).
 */
export function useModulos() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const esAdmin = roles.includes('ADMINISTRADOR');

  const { data, isLoading } = useQuery({
    queryKey: [...MIS_MODULOS_KEY, user?.id],
    queryFn: getMisModulos,
    enabled: !!user && !esAdmin,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const recibidos = Array.isArray(data?.modulos) ? data.modulos.filter(esIdModulo) : null;
  const visibles = new Set<ModuloWebId>(esAdmin ? MODULO_WEB_IDS : (recibidos ?? modulosPorDefecto(roles)));
  // Una API vieja no manda `permisos`: se usan las de fábrica de los módulos visibles.
  const acciones = Array.isArray(data?.permisos)
    ? data.permisos.filter(esPermisoId)
    : permisosConModulo(permisosPorDefecto(roles), [...visibles]);
  const permitidas = new Set<PermisoId>(esAdmin ? PERMISO_IDS : acciones);

  return {
    /** Aún no llega la respuesta del servidor (el menú usa la de fábrica mientras tanto). */
    cargando: isLoading,
    visibles,
    puedeVer: (id: ModuloWebId) => visibles.has(id),
    /** Solo oculta botones: el API vuelve a revisar cada acción (PermisoGuard). */
    puede: (id: PermisoId) => permitidas.has(id),
  };
}
