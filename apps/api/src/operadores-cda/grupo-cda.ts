import { BadRequestException } from '@nestjs/common';
import { grupoCdaQuerySchema } from '@cne/shared-validation';
import type { GrupoCda } from '@cne/shared-types';

/** Textos que cambian según el grupo (reportes, actas, carnets y mensajes). */
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
};

/** ?grupo= de la URL: ausente = OPERADOR; cualquier otro valor, 400. */
export function parsearGrupo(v: unknown): GrupoCda {
  const r = grupoCdaQuerySchema.safeParse(v);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Grupo inválido');
  return r.data;
}
