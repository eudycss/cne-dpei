import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SIN_TECNICO_PAREJAS_CDA } from '@cne/shared-validation';
import type { FormatoReporteCda, TecnicoParejasCda } from '@cne/shared-types';

import { type AsignacionTecnico, DistributivoTecnicosClient } from '../enlaces/distributivo-tecnicos.client';
import { ParejasCdaService } from './parejas-cda.service';
import { type ArchivoReporte, generarReporte } from './reporte-cda';
import { type GrupoTecnico, agruparPorTecnico, claveTecnico, contactosVcf, reporteTecnicos, resumenTecnicos } from './reporte-tecnicos-cda';

/**
 * "Reporte por técnico" de la pestaña Parejas: junta la lista del día con el
 * distributivo de técnicos del Drive (el mismo que lee el bot de enlaces).
 */
@Injectable()
export class ReporteTecnicosCdaService {
  private readonly logger = new Logger(ReporteTecnicosCdaService.name);

  constructor(
    private readonly parejas: ParejasCdaService,
    private readonly distributivo: DistributivoTecnicosClient,
  ) {}

  async tecnicos(fecha: string): Promise<TecnicoParejasCda[]> {
    const { grupos } = await this.grupos(fecha);
    return resumenTecnicos(grupos);
  }

  async reporte(fecha: string, tecnicos: string[], formato: FormatoReporteCda): Promise<ArchivoReporte> {
    const { dia, grupos } = await this.grupos(fecha);
    return generarReporte(reporteTecnicos(dia, elegir(grupos, tecnicos)), formato);
  }

  async contactos(fecha: string, tecnicos: string[]): Promise<ArchivoReporte> {
    const { grupos } = await this.grupos(fecha);
    const vcf = contactosVcf(elegir(grupos, tecnicos));
    if (!vcf) throw new BadRequestException('Los técnicos elegidos no tienen ningún contacto con celular este día');
    return { nombre: `contactos_parejas_${fecha}.vcf`, tipo: 'text/vcard; charset=utf-8', contenido: Buffer.from(vcf, 'utf8') };
  }

  private async grupos(fecha: string) {
    const [{ dia, filas }, asignaciones] = await Promise.all([this.parejas.listarConIngreso(fecha), this.asignaciones()]);
    return { dia, grupos: agruparPorTecnico(filas, asignaciones) };
  }

  private async asignaciones(): Promise<AsignacionTecnico[]> {
    try {
      return await this.distributivo.asignaciones();
    } catch (e) {
      this.logger.warn(`No se pudo leer el distributivo de técnicos: ${(e as Error).message}`);
      throw new ServiceUnavailableException('No se pudo leer el distributivo de técnicos (Drive). Intente en unos minutos.');
    }
  }
}

/** Los grupos pedidos, en el orden del distributivo; un nombre que no está en él es un error. */
function elegir(grupos: GrupoTecnico[], tecnicos: string[]): GrupoTecnico[] {
  const pedidos = new Set(tecnicos.map((t) => (t === SIN_TECNICO_PAREJAS_CDA ? t : claveTecnico(t))));
  const conocidos = new Set(grupos.flatMap((g) => (g.nombre ? [claveTecnico(g.nombre)] : [])));
  const desconocido = tecnicos.find((t) => t !== SIN_TECNICO_PAREJAS_CDA && !conocidos.has(claveTecnico(t)));
  if (desconocido) throw new BadRequestException(`Este técnico no está en el distributivo: ${desconocido.slice(0, 120)}`);
  const elegidos = grupos.filter((g) => pedidos.has(g.nombre ? claveTecnico(g.nombre) : SIN_TECNICO_PAREJAS_CDA));
  // "Sin técnico" pedido aunque todos los recintos estén en el distributivo: hoja que lo dice.
  if (pedidos.has(SIN_TECNICO_PAREJAS_CDA) && !grupos.some((g) => g.nombre === null)) {
    elegidos.push({ nombre: null, filas: [], parroquias: new Map() });
  }
  return elegidos;
}
