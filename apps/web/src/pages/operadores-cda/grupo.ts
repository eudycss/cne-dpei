import { createContext, useContext } from 'react';
import type { GrupoCda } from '@cne/shared-types';

/** Textos que cambian entre Operadores CDA y Asistentes CDA. */
export const TEXTOS_GRUPO: Record<
  GrupoCda,
  { titulo: string; plural: string; singular: string; Singular: string; cargoPorDefecto: string }
> = {
  OPERADOR: {
    titulo: 'Operadores CDA',
    plural: 'operadores',
    singular: 'operador',
    Singular: 'Operador',
    cargoPorDefecto: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - OPERADORES CDA',
  },
  // En el listado el cargo se ve igual que el de los operadores: Asist. Adm. Electoral Provincial.
  ASISTENTE: {
    titulo: 'Asistentes CDA',
    plural: 'asistentes',
    singular: 'asistente',
    Singular: 'Asistente',
    cargoPorDefecto: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - ASISTENTES CDA',
  },
};

/**
 * Grupo que se está viendo en la página CDAs. Todas las pestañas (listado,
 * asistencia, atrasos, actas) y sus modales lo leen de aquí: son los mismos
 * componentes para los dos grupos. Fuera de la página vale OPERADOR.
 */
export const GrupoCdaContext = createContext<GrupoCda>('OPERADOR');

export function useGrupoCda(): { grupo: GrupoCda } & (typeof TEXTOS_GRUPO)[GrupoCda] {
  const grupo = useContext(GrupoCdaContext);
  return { grupo, ...TEXTOS_GRUPO[grupo] };
}
