import { BadRequestException, Injectable } from '@nestjs/common';
import { rangoAsistenciaSchema } from '@cne/shared-validation';
import type {
  ConfigAsistenciaCda,
  EstadoPuntualidad,
  FilaAtrasoCda,
  FormatoReporteCda,
  GrupoCda,
  ReporteAtrasosCda,
  ResumenAtrasoOperadorCda,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { TEXTOS_GRUPO } from './grupo-cda';
import { diaDeFechaDb, diaEcuador, diasEntre, fechaDb, horaEcuador } from './dia-ecuador';
import { enTramos, personalDelCargo } from './periodos-cargo';
import { CONFIG_ASISTENCIA_POR_DEFECTO, clasificarEntrada } from './puntualidad';
import {
  type ArchivoReporte,
  type Celda,
  type ColumnaReporte,
  type TablaReporte,
  agruparPorDia,
  diaCorto,
  diaLargo,
  generarReporte,
  parsearModo,
} from './reporte-cda';

const ETIQUETA: Record<EstadoPuntualidad, string> = {
  PUNTUAL: 'Puntual',
  ATRASO: 'Atraso',
  FALTA: 'Falta',
  PENDIENTE: 'Pendiente',
};

const COLUMNAS_RESUMEN: ColumnaReporte[] = [
  { titulo: 'Apellidos y nombres', ancho: 40 },
  { titulo: 'Cédula', ancho: 13 },
  { titulo: 'Puntuales', ancho: 11 },
  { titulo: 'Atrasos', ancho: 10 },
  { titulo: 'Faltas', ancho: 9 },
  { titulo: 'Min. de atraso', ancho: 15 },
];

/** En el detalle general va además "Fecha" al inicio. */
const COLUMNAS_DETALLE: ColumnaReporte[] = [
  { titulo: 'Apellidos y nombres', ancho: 40 },
  { titulo: 'Cédula', ancho: 13 },
  { titulo: 'Hora oficial', ancho: 12 },
  { titulo: 'Entrada', ancho: 9 },
  { titulo: 'Min. de atraso', ancho: 15 },
  { titulo: 'Estado', ancho: 11 },
];

/** "3 puntuales · 1 atraso · 0 faltas" (+ pendientes si los hay). */
function conteoDelDia(filas: FilaAtrasoCda[]): string {
  const n = (e: EstadoPuntualidad) => filas.filter((f) => f.estado === e).length;
  const plural = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`;
  const partes = [
    plural(n('PUNTUAL'), 'puntual', 'puntuales'),
    plural(n('ATRASO'), 'atraso', 'atrasos'),
    plural(n('FALTA'), 'falta', 'faltas'),
  ];
  if (n('PENDIENTE') > 0) partes.push(plural(n('PENDIENTE'), 'pendiente', 'pendientes'));
  return partes.join(' · ');
}

/**
 * Reporte de atrasos de los operadores CDA a partir de la marca de entrada y
 * de una hora oficial global con minutos de gracia (ver `clasificarEntrada`).
 * Cambiar la hora recalcula también los días pasados: no se guarda por día.
 */
@Injectable()
export class AtrasosCdaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cada grupo tiene su propia hora y gracia; sin fila, los valores por defecto. */
  async getConfig(grupo: GrupoCda = 'OPERADOR'): Promise<ConfigAsistenciaCda> {
    const c = await this.prisma.configAsistenciaCda.findUnique({ where: { grupo } });
    return c ? { horaEntrada: c.horaEntrada, minutosGracia: c.minutosGracia } : { ...CONFIG_ASISTENCIA_POR_DEFECTO };
  }

  async guardarConfig(config: ConfigAsistenciaCda, grupo: GrupoCda = 'OPERADOR'): Promise<ConfigAsistenciaCda> {
    const { horaEntrada, minutosGracia } = config;
    const c = await this.prisma.configAsistenciaCda.upsert({
      where: { grupo },
      create: { grupo, horaEntrada, minutosGracia },
      update: { horaEntrada, minutosGracia },
    });
    return { horaEntrada: c.horaEntrada, minutosGracia: c.minutosGracia };
  }

  /** Un día por operador activo desde su fecha de inicio; hoy cuenta, el futuro no. */
  async reporte(desdeParam: unknown, hastaParam: unknown, grupo: GrupoCda = 'OPERADOR'): Promise<ReporteAtrasosCda> {
    const rango = rangoAsistenciaSchema.safeParse({ desde: desdeParam, hasta: hastaParam });
    if (!rango.success) throw new BadRequestException(rango.error.issues[0]?.message ?? 'Rango inválido');
    const { desde, hasta } = rango.data;
    const ahora = new Date();
    if (hasta > diaEcuador(ahora)) throw new BadRequestException('La fecha final no puede ser futura');

    const [config, personal] = await Promise.all([this.getConfig(grupo), personalDelCargo(this.prisma, grupo)]);
    const asistencias = await this.prisma.asistenciaCda.findMany({
      where: { fecha: { gte: fechaDb(desde), lte: fechaDb(hasta) }, operadorId: { in: personal.map((p) => p.operador.id) } },
      select: { operadorId: true, fecha: true, entradaEn: true },
    });
    const clave = (operadorId: string, dia: string) => `${operadorId}|${dia}`;
    const entradas = new Map<string, Date | null>(asistencias.map((a) => [clave(a.operadorId, diaDeFechaDb(a.fecha)), a.entradaEn]));

    const filas: FilaAtrasoCda[] = [];
    const resumen: ResumenAtrasoOperadorCda[] = [];
    const totales = { puntuales: 0, atrasos: 0, faltas: 0, pendientes: 0, minutosAtraso: 0 };
    const dias = diasEntre(desde, hasta);
    for (const { operador: o, tramos } of personal) {
      // Estuvo en este cargo, pero no en estas fechas: no es parte del reporte.
      if (o.grupo !== grupo && !dias.some((d) => enTramos(tramos, d))) continue;
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
      for (const dia of dias) {
        if (inicio && inicio > dia) continue;
        // Los días en otro cargo (antes o después de un cambio) no cuentan aquí, ni como falta.
        if (!enTramos(tramos, dia)) continue;
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

  /**
   * Excel o PDF con el resumen por operador y el detalle: en una tabla
   * (GENERAL) o una hoja/sección por día (POR_DIA).
   */
  async exportar(
    desde: unknown,
    hasta: unknown,
    modoParam: unknown,
    formato: FormatoReporteCda,
    grupo: GrupoCda = 'OPERADOR',
  ): Promise<ArchivoReporte> {
    const modo = parsearModo(modoParam);
    const rep = await this.reporte(desde, hasta, grupo);
    const textos = TEXTOS_GRUPO[grupo];
    const celdas = (f: FilaAtrasoCda): Celda[] => [
      f.apellidosNombres,
      f.cedula,
      rep.config.horaEntrada,
      f.entrada ?? '',
      f.estado === 'ATRASO' ? f.minutosAtraso : '',
      ETIQUETA[f.estado],
    ];

    const resumen: TablaReporte = {
      hoja: 'Resumen',
      titulo: `Resumen por ${textos.singular}`,
      columnas: COLUMNAS_RESUMEN,
      filas: rep.resumen.map((r) => [r.apellidosNombres, r.cedula, r.puntuales, r.atrasos, r.faltas, r.minutosAtraso]),
    };
    const detalle: TablaReporte[] =
      modo === 'GENERAL'
        ? [
            {
              hoja: 'Detalle',
              titulo: `Detalle por ${textos.singular} y día`,
              columnas: [{ titulo: 'Fecha', ancho: 12 }, ...COLUMNAS_DETALLE],
              filas: rep.filas.map((f) => [f.fecha, ...celdas(f)]),
            },
          ]
        : [...agruparPorDia(rep.filas)].map(([dia, delDia]) => ({
            hoja: dia,
            titulo: `${diaLargo(dia)} · ${conteoDelDia(delDia)}`,
            columnas: COLUMNAS_DETALLE,
            filas: delDia.map(celdas),
          }));

    return generarReporte(
      {
        titulo: `Reporte de atrasos — ${textos.titulo}`,
        detalle:
          `Hora de entrada ${rep.config.horaEntrada} · gracia ${rep.config.minutosGracia} min · ` +
          `del ${diaCorto(rep.desde)} al ${diaCorto(rep.hasta)}`,
        archivo: `atrasos_${textos.archivo}`,
        desde: rep.desde,
        hasta: rep.hasta,
        modo,
        tablas: [resumen, ...detalle],
      },
      formato,
    );
  }
}
