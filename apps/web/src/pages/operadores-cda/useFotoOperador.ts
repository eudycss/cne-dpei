import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OperadorCda } from '@cne/shared-types';
import { getFotoOperadorCda } from '../../lib/queries/operadores-cda';

/**
 * URL local (blob:) de la foto descifrada del operador, o null mientras carga
 * o si no tiene. Se cachea sin vencer: descifrarla cuesta CPU en la API.
 */
export function useFotoOperadorUrl(o: Pick<OperadorCda, 'id' | 'tieneFoto'>, habilitado = true): string | null {
  const { data } = useQuery({
    queryKey: ['operadores-cda', o.id, 'foto'],
    queryFn: () => getFotoOperadorCda(o.id),
    enabled: o.tieneFoto && habilitado,
    staleTime: Infinity,
    retry: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return setUrl(null);
    const u = URL.createObjectURL(data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);
  return url;
}
