import type { TipoRecinto } from '@cne/shared-types';

/** Tipos de recinto y su etiqueta visible (filtro de Recintos y modal crear/editar). */
export const TIPOS: TipoRecinto[] = ['CDA', 'NO_CDA'];
export const TIPO_LABELS: Record<TipoRecinto, string> = {
  CDA: 'CDA',
  NO_CDA: 'No CDA',
};
