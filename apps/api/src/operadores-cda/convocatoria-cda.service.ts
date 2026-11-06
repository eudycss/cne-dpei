import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  MAX_FECHAS_CARGA_CONVOCATORIA,
  MAX_FILAS_CARGA_CONVOCATORIA,
  diaAsistenciaSchema,
  guardarConvocatoriaCdaSchema,
  leerCedulaCelda,
  leerFechaCelda,
} from '@cne/shared-validation';
import type {
  CargaConvocatoriaCdaResult,
  ConvocatoriaCdaDia,
  FilaCargaConvocatoriaCda,
  GuardarConvocatoriaCdaRequest,
  ResumenFechaConvocatoriaCda,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { columna, leerFilasConNumero } from '../common/columnas-excel';
import { diaDeFechaDb, diasEntre, fechaDb } from './dia-ecuador';
import { convocadosEntre } from './convocatoria';

/** Un archivo cubre como mucho un año (las fechas se consultan como rango). */
const MAX_DIAS_RANGO = 366;

/** Encabezados que se aceptan (normalizados: sin tildes ni signos). */
const COLUMNAS = {
  fecha: ['fecha', 'dia', 'fechaconvocatoria', 'fechadelevento'],
  cedula: ['cedula', 'ci', 'identificacion', 'cedulaidentidad', 'numerodecedula', 'nrocedula', 'nocedula'],
} as const;

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
   * Excel de convocatoria: cada fila trae la Cédula y la Fecha (sin fecha, la
   * de `fechaParam`). Solo AGREGA convocados (no quita a nadie). Con `aplicar`
   * guarda las filas nuevas; sin él es la vista previa. El resumen por fecha
   * dice cuántos convocados quedan y cuántos de ellos no marcaron entrada.
   */
  async cargar(
    file: Express.Multer.File | undefined,
    fechaParam: unknown,
    aplicar: boolean,
    usuarioId?: string,
  ): Promise<CargaConvocatoriaCdaResult> {
    if (!file) throw new BadRequestException('Adjunte el archivo de la convocatoria');
    const porDefecto = typeof fechaParam === 'string' && fechaParam ? parsearDia(fechaParam) : null;
    const datos = await leerFilasConNumero(file, 'la plantilla de convocatoria', MAX_FILAS_CARGA_CONVOCATORIA);
    if (datos.length === 0) throw new BadRequestException('El archivo no tiene filas');
    if (datos.length > MAX_FILAS_CARGA_CONVOCATORIA) {
      throw new BadRequestException(`El archivo tiene ${datos.length} filas; el máximo es ${MAX_FILAS_CARGA_CONVOCATORIA}`);
    }

    // Primero lo que dice cada fila; las personas y la convocatoria actual se buscan de una vez.
    const leidas = datos.map(({ fila, datos: d }) => {
      const fechaEscrita = columna(d, COLUMNAS.fecha);
      const cedulaEscrita = columna(d, COLUMNAS.cedula);
      return {
        fila,
        fechaEscrita,
        cedulaEscrita,
        fecha: fechaEscrita ? leerFechaCelda(fechaEscrita) : porDefecto,
        cedula: leerCedulaCelda(cedulaEscrita),
      };
    });
    const fechasValidas = [...new Set(leidas.map((l) => l.fecha).filter((f): f is string => !!f))].sort();
    if (fechasValidas.length > MAX_FECHAS_CARGA_CONVOCATORIA) {
      throw new BadRequestException(`El archivo trae ${fechasValidas.length} fechas; el máximo es ${MAX_FECHAS_CARGA_CONVOCATORIA}`);
    }
    // Las fechas se consultan como rango: muy separadas, la consulta traería años de parejas.
    if (fechasValidas.length > 1 && diasEntre(fechasValidas[0], fechasValidas[fechasValidas.length - 1]).length > MAX_DIAS_RANGO) {
      throw new BadRequestException(
        `Las fechas van del ${fechasValidas[0]} al ${fechasValidas[fechasValidas.length - 1]}: cargue como máximo un año por archivo`,
      );
    }
    const cedulas = [...new Set(leidas.map((l) => l.cedula).filter((c): c is string => !!c))];
    const [personas, convocados] = await Promise.all([
      this.prisma.operadorCda.findMany({
        where: { cedula: { in: cedulas } },
        select: { id: true, cedula: true, apellidosNombres: true, activo: true },
      }),
      fechasValidas.length > 0
        ? convocadosEntre(this.prisma, fechasValidas[0], fechasValidas[fechasValidas.length - 1])
        : null,
    ]);
    const porCedula = new Map<string, (typeof personas)[number]>(personas.map((p) => [p.cedula, p]));

    const vistas = new Map<string, number>();
    const nuevas: { fecha: string; operadorId: string }[] = [];
    const filas = leidas.map((l): FilaCargaConvocatoriaCda => {
      const persona = l.cedula ? porCedula.get(l.cedula) : undefined;
      const base = {
        fila: l.fila,
        fecha: l.fecha,
        cedula: l.cedula ?? (l.cedulaEscrita || null),
        apellidosNombres: persona?.apellidosNombres ?? null,
      };
      const error = (mensaje: string): FilaCargaConvocatoriaCda => ({ ...base, estado: 'ERROR', mensaje });
      if (!l.cedula) return error(l.cedulaEscrita ? `"${l.cedulaEscrita}" no es una cédula (10 dígitos)` : 'Falta la cédula');
      if (!l.fecha) {
        return error(l.fechaEscrita ? `"${l.fechaEscrita}" no es una fecha (use 05/11/2026 o 2026-11-05)` : 'Falta la fecha: elija el día en la pantalla o agregue la columna Fecha');
      }
      if (!persona) return error('No hay nadie del personal CDA/CPE con esa cédula');
      if (!persona.activo) return error('Está oculta: reactívela en Listado para convocarla');
      const clave = `${l.fecha}|${persona.id}`;
      const repetida = vistas.get(clave);
      if (repetida) return error(`Repetida: ya está en la fila ${repetida}`);
      vistas.set(clave, l.fila);
      if (convocados?.esPorPareja(l.fecha, persona.id)) return { ...base, estado: 'EN_PAREJAS', mensaje: 'Ya convocada: va en Parejas ese día' };
      if (convocados?.esAMano(l.fecha, persona.id)) return { ...base, estado: 'YA_CONVOCADA', mensaje: 'Ya estaba convocada' };
      nuevas.push({ fecha: l.fecha, operadorId: persona.id });
      return { ...base, estado: 'NUEVA', mensaje: null };
    });

    // Lo que de verdad se guardó: si otra carga agregó a alguien a la vez, no se cuenta dos veces.
    let guardadas = nuevas.length;
    if (aplicar && nuevas.length > 0) {
      ({ count: guardadas } = await this.prisma.convocatoriaCda.createMany({
        data: nuevas.map((n) => ({ fecha: fechaDb(n.fecha), operadorId: n.operadorId, creadoPorId: usuarioId ?? null })),
        skipDuplicates: true,
      }));
    }
    const fechasDelArchivo = [...new Set(filas.filter((f) => f.estado !== 'ERROR').map((f) => f.fecha!))].sort();
    return {
      aplicada: aplicar && nuevas.length > 0,
      filas,
      nuevas: guardadas,
      errores: filas.filter((f) => f.estado === 'ERROR').length,
      fechas: await this.resumenPorFecha(fechasDelArchivo, convocados, nuevas),
    };
  }

  /** Convocados de cada fecha (los que ya había más los nuevos) y cuántos marcaron entrada. */
  private async resumenPorFecha(
    fechas: string[],
    convocados: Awaited<ReturnType<typeof convocadosEntre>> | null,
    nuevas: { fecha: string; operadorId: string }[],
  ): Promise<ResumenFechaConvocatoriaCda[]> {
    if (fechas.length === 0) return [];
    const delDia = new Map<string, Set<string>>(fechas.map((f) => [f, convocados?.delDia(f) ?? new Set<string>()]));
    for (const n of nuevas) delDia.get(n.fecha)?.add(n.operadorId);
    const ids = [...new Set([...delDia.values()].flatMap((s) => [...s]))];
    const entradas = await this.prisma.asistenciaCda.findMany({
      where: { fecha: { in: fechas.map(fechaDb) }, operadorId: { in: ids }, entradaEn: { not: null } },
      select: { fecha: true, operadorId: true },
    });
    const vinieron = new Set(entradas.map((e) => `${diaDeFechaDb(e.fecha)}|${e.operadorId}`));
    return fechas.map((fecha) => {
      const lista = [...delDia.get(fecha)!];
      const conEntrada = lista.filter((id) => vinieron.has(`${fecha}|${id}`)).length;
      return { fecha, convocados: lista.length, vinieron: conEntrada, sinEntrada: lista.length - conEntrada };
    });
  }

  /** Plantilla del Excel de convocatoria (Fecha y Cédula; el nombre solo ayuda a revisar). */
  async plantilla(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Convocatoria');
    ws.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Cédula', key: 'cedula', width: 13 },
      { header: 'Apellidos y nombres', key: 'nombre', width: 40 },
    ];
    ws.getRow(1).font = { bold: true };
    // Texto (no número) para que Excel no le quite el 0 a la cédula.
    ws.getColumn('cedula').numFmt = '@';
    ws.addRow({ fecha: '05/11/2026', cedula: '1001234567', nombre: 'EJEMPLO PÉREZ ANA (borre esta fila)' });
    const ayuda = wb.addWorksheet('Cómo llenarla');
    ayuda.getColumn(1).width = 100;
    for (const linea of [
      'Una fila por persona y día que se convocó. La Fecha puede ir como 05/11/2026 o 2026-11-05.',
      'Si todas las filas son del mismo día, puede dejar la Fecha vacía y elegir el día en la pantalla.',
      'Solo agrega convocados: quien se convoca y no marcó asistencia ese día queda con falta.',
      'Quienes van en Parejas ese día ya están convocados (no hace falta ponerlos).',
    ]) {
      ayuda.addRow([linea]);
    }
    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
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
