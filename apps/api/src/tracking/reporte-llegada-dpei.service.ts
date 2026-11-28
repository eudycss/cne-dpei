import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FormatoReporteCda, ReporteLlegadaDpei } from '@cne/shared-types';

import { JornadaService, diaDeJornada } from '../enlaces/jornada/jornada.service';
import { generarReporte, type ArchivoReporte } from '../operadores-cda/reporte-cda';
import { archivoLlegadaDpei, reporteLlegadaDpei } from './reporte-llegada-dpei';

/** Reporte de llegadas de los CDA a la DPEI de un día de jornada (por defecto, el actual). */
@Injectable()
export class ReporteLlegadaDpeiService {
  constructor(private readonly jornada: JornadaService) {}

  /**
   * null si no hay un evento activo. Una fecha pasada usa las parejas de ese día
   * (o la anterior más reciente) pero el operador actual de cada kit.
   */
  async reporte(fecha?: string, ahora = Date.now()): Promise<ReporteLlegadaDpei | null> {
    const hoy = diaDeJornada(new Date(ahora)).fecha;
    if (fecha && fecha > hoy) throw new BadRequestException('La jornada elegida todavía no empieza');
    const dia = fecha ?? hoy;
    const j = await this.jornada.cargarDia(dia, ahora);
    return j ? reporteLlegadaDpei(j, dia) : null;
  }

  async exportar(fecha: string | undefined, formato: FormatoReporteCda): Promise<ArchivoReporte> {
    const r = await this.reporte(fecha);
    if (!r) throw new NotFoundException('No hay un evento activo');
    return generarReporte(archivoLlegadaDpei(r), formato);
  }
}
