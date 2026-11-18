import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { claveFotoPersona, getFotoPersonaPlan } from '../../lib/queries/perimetro';

/**
 * Foto de la persona del puesto. Se pide solo al abrir su tarjeta y, por ser un
 * dato personal, no se queda en la caché de la app (gcTime 0) ni en la del
 * navegador (el API responde no-store). Quien la use debe darle key por persona.
 */
export function FotoPersona({ planId, operadorId, nombre }: { planId: string; operadorId: string; nombre: string }) {
  const { data, isError } = useQuery({
    queryKey: claveFotoPersona(planId, operadorId),
    queryFn: () => getFotoPersonaPlan(planId, operadorId),
    gcTime: 0,
    retry: false,
  });
  // La URL sale del blob de ESTA persona: nunca queda la de otra mientras carga.
  const url = useMemo(() => (data ? URL.createObjectURL(data) : null), [data]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  if (isError || !url) {
    return (
      <div
        className="pp-foto pp-foto--vacia"
        role="img"
        aria-label={isError ? `No se pudo cargar la foto de ${nombre}` : `Cargando foto de ${nombre}`}
      >
        <UserRound size={40} aria-hidden="true" />
      </div>
    );
  }
  return <img className="pp-foto" src={url} alt={`Foto de ${nombre}`} />;
}
