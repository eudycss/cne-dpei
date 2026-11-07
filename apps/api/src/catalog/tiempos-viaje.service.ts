import { BadRequestException, Injectable } from '@nestjs/common';
import { MARGEN_TIEMPO_VIAJE_MIN } from '@cne/shared-validation';
import type { GuardarTiemposViajeRequest, GuardarTiemposViajeResult, TiemposViajeRecintos } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { sugerirTiempos, type MedicionRecinto } from './tiempos-viaje';

/** Un viaje más corto o más largo que esto es un registro mal hecho (olvidó marcar), no un viaje. */
const VIAJE_MIN_MINUTOS = 1;
const VIAJE_MAX_MINUTOS = 360;

/**
 * Tiempo de viaje de cada CDA desde la Delegación (`recintos.tiempo_dpi_min`):
 * el límite de los avisos de retraso del bot Jornada, de ida y de vuelta.
 */
@Injectable()
export class TiemposViajeService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(): Promise<TiemposViajeRecintos> {
    const [recintos, medidos] = await Promise.all([
      this.prisma.recinto.findMany({
        where: { tipo: 'CDA', activo: true },
        select: { id: true, codigoRecinto: true, nombre: true, tiempoDpiMin: true, canton: { select: { nombre: true } } },
        orderBy: [{ canton: { nombre: 'asc' } }, { nombre: 'asc' }],
      }),
      this.viajesMedidos(),
    ]);
    return {
      margenMin: MARGEN_TIEMPO_VIAJE_MIN,
      recintos: sugerirTiempos(
        recintos.map((r) => ({ id: r.id, codigo: r.codigoRecinto, nombre: r.nombre, canton: r.canton.nombre, tiempoMin: r.tiempoDpiMin })),
        medidos,
        MARGEN_TIEMPO_VIAJE_MIN,
      ),
    };
  }

  async guardar({ tiempos }: GuardarTiemposViajeRequest): Promise<GuardarTiemposViajeResult> {
    const ids = tiempos.map((t) => t.recintoId);
    const validos = await this.prisma.recinto.count({ where: { id: { in: ids }, tipo: 'CDA', activo: true } });
    if (validos !== ids.length) throw new BadRequestException('Solo los CDA activos tienen tiempo de viaje');
    // Todos o ninguno: "Aplicar sugeridos" no queda a medias. Condicional: si un CDA
    // se desactivó o borró entre la revisión y el guardado, se rechaza todo (400, no 500).
    await this.prisma.$transaction(async (tx) => {
      for (const t of tiempos) {
        const { count } = await tx.recinto.updateMany({
          where: { id: t.recintoId, tipo: 'CDA', activo: true },
          data: { tiempoDpiMin: t.minutos },
        });
        if (count !== 1) throw new BadRequestException('Un CDA cambió mientras tanto: recargue la lista');
      }
    });
    return { actualizados: tiempos.length };
  }

  /**
   * Viajes medidos en todos los eventos: Salida DPEI → la Llegada al recinto
   * que le sigue (ida) y Salida del recinto → la Llegada al DPEI que le sigue
   * (vuelta), por operador y evento. Las llegadas registradas a mano desde la
   * web no cuentan (su hora es aproximada).
   */
  private async viajesMedidos(): Promise<Map<string, MedicionRecinto>> {
    const filas = await this.prisma.$queryRaw<{ recintoId: string; maxMin: number; viajes: number }[]>`
      WITH t AS (
        SELECT tipo, recinto_id, ocurrido_en,
               LEAD(tipo) OVER w AS sig_tipo,
               LEAD(ocurrido_en) OVER w AS sig_en,
               LEAD(recinto_id) OVER w AS sig_recinto
        FROM eventos_tracking
        WHERE tipo IN ('SALIDA_DPI', 'LLEGADA_RECINTO', 'SALIDA_RECINTO', 'LLEGADA_DPI')
          AND registrado_por_id IS NULL
        WINDOW w AS (PARTITION BY evento_id, operador_id ORDER BY ocurrido_en, registrado_en, id)
      ), viajes AS (
        SELECT CASE WHEN tipo = 'SALIDA_DPI' THEN COALESCE(sig_recinto, recinto_id) ELSE COALESCE(recinto_id, sig_recinto) END AS recinto_id,
               EXTRACT(EPOCH FROM (sig_en - ocurrido_en)) / 60.0 AS minutos
        FROM t
        WHERE (tipo = 'SALIDA_DPI' AND sig_tipo = 'LLEGADA_RECINTO')
           OR (tipo = 'SALIDA_RECINTO' AND sig_tipo = 'LLEGADA_DPI')
      )
      SELECT recinto_id::text AS "recintoId", MAX(minutos)::float8 AS "maxMin", COUNT(*)::int AS viajes
      FROM viajes
      WHERE recinto_id IS NOT NULL AND minutos BETWEEN ${VIAJE_MIN_MINUTOS} AND ${VIAJE_MAX_MINUTOS}
      GROUP BY recinto_id
    `;
    return new Map(filas.map((f): [string, MedicionRecinto] => [f.recintoId, { maxMin: Number(f.maxMin), viajes: Number(f.viajes) }]));
  }
}
