import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { rangoAsistenciaSchema } from '@cne/shared-validation';
import type {
  ConfigAsistenciaCda,
  EstadoPuntualidad,
  FilaAtrasoCda,
  ReporteAtrasosCda,
  ResumenAtrasoOperadorCda,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { diaDeFechaDb, diaEcuador, diasEntre, fechaDb, horaEcuador } from './dia-ecuador';
import { CONFIG_ASISTENCIA_POR_DEFECTO, clasificarEntrada } from './puntualidad';

const CONFIG_ID = 1;

const ETIQUETA: Record<EstadoPuntualidad, string> = {
  PUNTUAL: 'Puntual',
  ATRASO: 'Atraso',
  FALTA: 'Falta',
  PENDIENTE: 'Pendiente',
};

/**
 * Reporte de atrasos de los operadores CDA a partir de la marca de entrada y
 * de una hora oficial global con minutos de gracia (ver `clasificarEntrada`).
 * Cambiar la hora recalcula también los días pasados: no se guarda por día.
 */
@Injectable()
export class AtrasosCdaService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<ConfigAsistenciaCda> {
    const c = await this.prisma.configAsistenciaCda.findUnique({ where: { id: CONFIG_ID } });
    return c ? { horaEntrada: c.horaEntrada, minutosGracia: c.minutosGracia } : { ...CONFIG_ASISTENCIA_POR_DEFECTO };
  }

  async guardarConfig(config: ConfigAsistenciaCda): Promise<ConfigAsistenciaCda> {
    const { horaEntrada, minutosGracia } = config;
    const c = await this.prisma.configAsistenciaCda.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, horaEntrada, minutosGracia },
      update: { horaEntrada, minutosGracia },
    });
    return { horaEntrada: c.horaEntrada, minutosGracia: c.minutosGracia };
  }

  /** Un día por operador activo desde su fecha de inicio; hoy cuenta, el futuro no. */
  async reporte(desdeParam: unknown, hastaParam: unknown): Promise<ReporteAtrasosCda> {
    const rango = rangoAsistenciaSchema.safeParse({ desde: desdeParam, hasta: hastaParam });
    if (!rango.success) throw new BadRequestException(rango.error.issues[0]?.message ?? 'Rango inválido');
    const { desde, hasta } = rango.data;
    const ahora = new Date();
    if (hasta > diaEcuador(ahora)) throw new BadRequestException('La fecha final no puede ser futura');

    const [config, operadores, asistencias] = await Promise.all([
      this.getConfig(),
      this.prisma.operadorCda.findMany({ where: { activo: true }, orderBy: { apellidosNombres: 'asc' } }),
      this.prisma.asistenciaCda.findMany({
        where: { fecha: { gte: fechaDb(desde), lte: fechaDb(hasta) } },
        select: { operadorId: true, fecha: true, entradaEn: true },
      }),
    ]);
    const clave = (operadorId: string, dia: string) => `${operadorId}|${dia}`;
    const entradas = new Map(asistencias.map((a) => [clave(a.operadorId, diaDeFechaDb(a.fecha)), a.entradaEn]));

    const filas: FilaAtrasoCda[] = [];
    const resumen: ResumenAtrasoOperadorCda[] = [];
    const totales = { puntuales: 0, atrasos: 0, faltas: 0, pendientes: 0, minutosAtraso: 0 };
    for (const o of operadores) {
      const r: ResumenAtrasoOperadorCda = {
        operadorId: o.id,
        apellidosNombres: o.apellidosNombres,
        cedula: o.cedula,
        puntuales: 0,
        atrasos: 0,
        faltas: 0,
        minutosAtraso: 0,
      };
      const inicio = o.fechaInicio ? diaDeFechaDb(o.fechaInicio) : null;
      for (const dia of diasEntre(desde, hasta)) {
        if (inicio && inicio > dia) continue;
        const entradaEn = entradas.get(clave(o.id, dia)) ?? null;
        const { estado, minutosAtraso } = clasificarEntrada(entradaEn, dia, config, ahora);
        filas.push({
          fecha: dia,
          operadorId: o.id,
          apellidosNombres: o.apellidosNombres,
          cedula: o.cedula,
          entrada: entradaEn ? horaEcuador(entradaEn) : null,
          minutosAtraso,
          estado,
        });
        if (estado === 'PUNTUAL') r.puntuales++;
        else if (estado === 'ATRASO') r.atrasos++;
        else if (estado === 'FALTA') r.faltas++;
        else totales.pendientes++;
        r.minutosAtraso += minutosAtraso;
      }
      totales.puntuales += r.puntuales;
      totales.atrasos += r.atrasos;
      totales.faltas += r.faltas;
      totales.minutosAtraso += r.minutosAtraso;
      resumen.push(r);
    }
    filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.apellidosNombres.localeCompare(b.apellidosNombres));
    return { desde, hasta, config, totales, resumen, filas };
  }

  /** Excel con el resumen por operador y el detalle por día. */
  async exportar(desde: unknown, hasta: unknown): Promise<Buffer> {
    const rep = await this.reporte(desde, hasta);
    const regla = `Hora de entrada ${rep.config.horaEntrada} · gracia ${rep.config.minutosGracia} min · del ${rep.desde} al ${rep.hasta}`;
    const wb = new ExcelJS.Workbook();

    const res = wb.addWorksheet('Resumen');
    res.addRow([regla]).font = { italic: true };
    res.addRow(['Apellidos y nombres', 'Cédula', 'Puntuales', 'Atrasos', 'Faltas', 'Min. de atraso']).font = { bold: true };
    for (const r of rep.resumen) {
      res.addRow([r.apellidosNombres, r.cedula, r.puntuales, r.atrasos, r.faltas, r.minutosAtraso]);
    }
    res.columns.forEach((c, i) => (c.width = [40, 13, 11, 10, 9, 15][i]));
    res.views = [{ state: 'frozen', ySplit: 2 }];

    const det = wb.addWorksheet('Detalle');
    det.addRow([regla]).font = { italic: true };
    det.addRow(['Fecha', 'Apellidos y nombres', 'Cédula', 'Hora oficial', 'Entrada', 'Min. de atraso', 'Estado']).font = {
      bold: true,
    };
    for (const f of rep.filas) {
      det.addRow([
        f.fecha,
        f.apellidosNombres,
        f.cedula,
        rep.config.horaEntrada,
        f.entrada ?? '',
        f.estado === 'ATRASO' ? f.minutosAtraso : '',
        ETIQUETA[f.estado],
      ]);
    }
    det.columns.forEach((c, i) => (c.width = [12, 40, 13, 12, 9, 15, 11][i]));
    det.views = [{ state: 'frozen', ySplit: 2 }];

    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  }
}
