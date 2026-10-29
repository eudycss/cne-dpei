import { BadRequestException } from '@nestjs/common';
import { grupoCdaQuerySchema } from '@cne/shared-validation';
import type { GrupoCda } from '@cne/shared-types';

/**
 * Textos que cambian según el grupo (reportes, actas, carnets y mensajes).
 * Solo operadores y asistentes son CDA; el resto dice CPE.
 */
export const TEXTOS_GRUPO: Record<
  GrupoCda,
  { titulo: string; contador: string; cargo: string; archivo: string; singular: string }
> = {
  OPERADOR: {
    titulo: 'Operadores CDA',
    contador: 'Operadores',
    cargo: 'OPERADOR CDA',
    archivo: 'operadores_cda',
    singular: 'operador',
  },
  ASISTENTE: {
    titulo: 'Asistentes CDA',
    contador: 'Asistentes',
    cargo: 'ASISTENTE CDA',
    archivo: 'asistentes_cda',
    singular: 'asistente',
  },
  DIGITADOR: {
    titulo: 'Digitadores',
    contador: 'Digitadores',
    cargo: 'DIGITADOR CPE',
    archivo: 'digitadores_cpe',
    singular: 'digitador',
  },
  ASISTENTE_ARCHIVOS: {
    titulo: 'Asistentes de Archivos',
    contador: 'Asistentes de Archivos',
    cargo: 'ASISTENTE DE ARCHIVOS CPE',
    archivo: 'asistentes_archivos_cpe',
    singular: 'asistente de archivos',
  },
  ASISTENTE_FIRMAS: {
    titulo: 'Asistentes de firmas',
    contador: 'Asistentes de firmas',
    cargo: 'ASISTENTE DE FIRMAS CPE',
    archivo: 'asistentes_firmas_cpe',
    singular: 'asistente de firmas',
  },
  RECEPTOR_ACTAS: {
    titulo: 'Receptores de actas',
    contador: 'Receptores',
    cargo: 'RECEPTOR DE ACTAS CPE',
    archivo: 'receptores_actas_cpe',
    singular: 'receptor de actas',
  },
  ARCHIVADOR_ACTAS: {
    titulo: 'Archivadores de actas',
    contador: 'Archivadores',
    cargo: 'ARCHIVADOR DE ACTAS CPE',
    archivo: 'archivadores_actas_cpe',
    singular: 'archivador de actas',
  },
  SUPERVISOR: {
    titulo: 'Supervisores',
    contador: 'Supervisores',
    cargo: 'SUPERVISOR CPE',
    archivo: 'supervisores_cpe',
    singular: 'supervisor',
  },
  OPERADOR_ESCANER_CPE: {
    titulo: 'Operadores de escáner CPE',
    contador: 'Operadores de escáner',
    cargo: 'OPERADOR DE ESCÁNER CPE',
    archivo: 'operadores_escaner_cpe',
    singular: 'operador de escáner CPE',
  },
};

/** ?grupo= de la URL: ausente = OPERADOR; cualquier otro valor, 400. */
export function parsearGrupo(v: unknown): GrupoCda {
  const r = grupoCdaQuerySchema.safeParse(v);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Grupo inválido');
  return r.data;
}
