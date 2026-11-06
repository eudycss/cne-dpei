import { BadRequestException, Injectable } from '@nestjs/common';
import { diaAsistenciaSchema, guardarConvocatoriaCdaSchema } from '@cne/shared-validation';
import type { ConvocatoriaCdaDia, GuardarConvocatoriaCdaRequest } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { fechaDb } from './dia-ecuador';
import { convocadosEntre } from './convocatoria';

function parsearDia(dia: unknown): string {
  const r = diaAsistenciaSchema.safeParse(dia);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Fecha inválida');
  return r.data;
}

/** Resultado de guardar: el día como quedó y cuántos se agregaron o quitaron (para la bitácora). */
export type GuardarConvocatoriaCdaResult = ConvocatoriaCdaDia & { agregados: number; quitados: number };

/**
 * Convocatoria del día: a quién se llamó del personal CDA y CPE. Quienes
 * están en Parejas esa fecha cuentan solos (no se guardan aquí). Solo los
 * convocados pueden tener falta en la asistencia y en los atrasos.
 */
@Injectable()
export class ConvocatoriaCdaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Todo el personal activo con quién está convocado ese día, por centro (CDA/CPE), cargo y nombre. */
  async dia(fechaParam: unknown): Promise<ConvocatoriaCdaDia> {
    const dia = parsearDia(fechaParam);
    const [personal, convocados] = await Promise.all([
      this.prisma.operadorCda.findMany({
        where: { activo: true },
        select: {
          id: true,
          apellidosNombres: true,
          cedula: true,
          grupo: true,
          cargoCda: { select: { nombre: true, centro: true, orden: true } },
        },
      }),
      convocadosEntre(this.prisma, dia, dia),
    ]);
    const personas = personal
      .sort(
        (a, b) =>
          a.cargoCda.centro.localeCompare(b.cargoCda.centro) ||
          a.cargoCda.orden - b.cargoCda.orden ||
          a.apellidosNombres.localeCompare(b.apellidosNombres, 'es'),
      )
      .map((p) => ({
        operadorId: p.id,
        apellidosNombres: p.apellidosNombres,
        cedula: p.cedula,
        grupo: p.grupo,
        cargo: p.cargoCda.nombre,
        centro: p.cargoCda.centro,
        convocado: convocados.es(dia, p.id),
        porPareja: convocados.esPorPareja(dia, p.id),
      }));
    return { fecha: dia, personas, convocados: personas.filter((p) => p.convocado).length, total: personas.length };
  }

  /**
   * Deja como convocados a mano de ese día exactamente `operadorIds` (además de
   * los de Parejas, que no se guardan aquí). Solo personal activo.
   */
  async guardar(
    fechaParam: unknown,
    input: GuardarConvocatoriaCdaRequest,
    usuarioId?: string,
  ): Promise<GuardarConvocatoriaCdaResult> {
    const dia = parsearDia(fechaParam);
    const { operadorIds } = guardarConvocatoriaCdaSchema.parse(input);
    const [activos, convocados] = await Promise.all([
      this.prisma.operadorCda.findMany({ where: { id: { in: operadorIds }, activo: true }, select: { id: true } }),
      convocadosEntre(this.prisma, dia, dia),
    ]);
    if (activos.length !== operadorIds.length) {
      throw new BadRequestException('Alguna persona no existe o está oculta: recargue la convocatoria');
    }
    // Los de Parejas ya cuentan: no se duplican aquí.
    const quedan = operadorIds.filter((id) => !convocados.esPorPareja(dia, id));

    // En una sola transacción y sin leer antes: dos guardados a la vez no dejan una mezcla.
    // Al personal oculto no se le quita su convocatoria (no se ve en la pantalla y es historia).
    const [quitados, agregados] = await this.prisma.$transaction([
      this.prisma.convocatoriaCda.deleteMany({
        where: { fecha: fechaDb(dia), operadorId: { notIn: quedan }, operador: { activo: true } },
      }),
      this.prisma.convocatoriaCda.createMany({
        data: quedan.map((operadorId) => ({ fecha: fechaDb(dia), operadorId, creadoPorId: usuarioId ?? null })),
        skipDuplicates: true,
      }),
    ]);
    return { ...(await this.dia(dia)), agregados: agregados.count, quitados: quitados.count };
  }
}
