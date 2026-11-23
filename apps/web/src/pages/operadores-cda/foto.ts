import type { OperadorCda } from '@cne/shared-types';

/**
 * '' = todos; CON = foto aprobada; SIN = aún no sube ninguna (ni pendiente);
 * REVISAR = subió una nueva y espera la aprobación de la Delegación.
 */
export type FiltroFoto = '' | 'CON' | 'SIN' | 'REVISAR';

export function cumpleFoto(o: Pick<OperadorCda, 'tieneFoto' | 'fotoPendiente'>, filtro: FiltroFoto): boolean {
  switch (filtro) {
    case 'CON':
      return o.tieneFoto;
    case 'SIN':
      return !o.tieneFoto && !o.fotoPendiente;
    case 'REVISAR':
      return o.fotoPendiente;
    default:
      return true;
  }
}
