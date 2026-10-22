import { useQuery } from '@tanstack/react-query';
import type { Asignacion, EventoElectoral, Paginated } from '@cne/shared-types';
import { api } from '../api';
import { PASOS_PREPARACION, type PasoId } from '../flujo';

export interface EstadoPreparacion {
  conteos: Record<PasoId, number>;
  evento: EventoElectoral | null;
}

const total = (url: string) => api.get<Paginated<unknown>>(url).then((r) => r.data.total);

/**
 * Cuenta lo que ya existe en cada paso con los listados de siempre: se pide
 * una sola fila y se lee `total`. Asignaciones y kits dependen del evento activo.
 */
async function getEstadoPreparacion(): Promise<EstadoPreparacion> {
  const [recintos, usuarios, militares, eventoRes] = await Promise.all([
    total('/recintos?pageSize=1'),
    total('/users?role=OPERADOR_CDA&activo=true&pageSize=1'),
    total('/militares?pageSize=1'),
    api.get<EventoElectoral | ''>('/eventos/active'),
  ]);
  // Sin evento activo el API responde con cuerpo vacío.
  const evento = typeof eventoRes.data === 'object' && eventoRes.data?.id ? eventoRes.data : null;
  const [asignaciones, kits] = evento
    ? await Promise.all([
        api.get<Asignacion[]>(`/asignaciones?eventoId=${evento.id}`).then((r) => r.data.length),
        total(`/kits?eventoId=${evento.id}&pageSize=1`),
      ])
    : [0, 0];
  return {
    conteos: { recintos, usuarios, militares, evento: evento ? 1 : 0, asignaciones, kits },
    evento,
  };
}

export function usePreparacion() {
  // Los cambios hechos desde la web ya invalidan esta consulta (ver PasoFlujo);
  // el margen evita repetir 4-6 peticiones en cada cambio de página.
  return useQuery({ queryKey: ['preparacion'], queryFn: getEstadoPreparacion, staleTime: 30_000 });
}

/** Primer paso que todavía no tiene datos; undefined si todo está listo. */
export function pasoActual(conteos: Record<PasoId, number>): PasoId | undefined {
  return PASOS_PREPARACION.find((p) => conteos[p.id] === 0)?.id;
}
