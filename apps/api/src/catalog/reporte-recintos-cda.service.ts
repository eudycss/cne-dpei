import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { FormatoReporteCda } from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';
import { diaEcuador } from '../operadores-cda/dia-ecuador';
import { type ArchivoReporte, generarReporte } from '../operadores-cda/reporte-cda';
import { type RecintoReporte, reporteRecintosCda } from './reporte-recintos-cda';

/** Excel/PDF de cada recinto CDA con los recintos NO CDA que se le asignan. */
@Injectable()
export class ReporteRecintosCdaService {
  constructor(private readonly prisma: PrismaService) {}

  async reporte(formato: FormatoReporteCda, cantonId?: number): Promise<ArchivoReporte> {
    const cdas = await this.leer({ tipo: 'CDA', ...(cantonId ? { cantonId } : {}) });
    // Con filtro de cantón: los NO CDA de sus CDA (aunque sean de otro cantón) y los sueltos del cantón.
    const noCdas = await this.leer({
      tipo: 'NO_CDA',
      ...(cantonId
        ? { OR: [{ cdaDestinoId: { in: cdas.map((c) => c.id) } }, { cantonId, cdaDestinoId: null }] }
        : {}),
    });
    const canton = cantonId ? (await this.prisma.canton.findUnique({ where: { id: cantonId }, select: { nombre: true } }))?.nombre : undefined;
    return generarReporte(reporteRecintosCda(cdas, noCdas, diaEcuador(), canton), formato);
  }

  private async leer(where: Prisma.RecintoWhereInput): Promise<RecintoReporte[]> {
    const rows = await this.prisma.recinto.findMany({
      where: { activo: true, ...where },
      select: {
        id: true,
        codigoRecinto: true,
        nombre: true,
        parroquia: true,
        direccion: true,
        juntasFemeninas: true,
        juntasMasculinas: true,
        cdaDestinoId: true,
        canton: { select: { nombre: true } },
      },
    });
    return rows.map(({ canton, ...r }) => ({ ...r, cantonNombre: canton.nombre }));
  }
}
