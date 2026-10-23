import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { diaAsistenciaSchema } from '@cne/shared-validation';
import type {
  AsistenciaCdaDia,
  AsistenciaCdaFila,
  MarcarAsistenciaCdaMasivaResult,
  TipoMarcaAsistenciaCda,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { toOperadorCdaDto } from './operadores-cda.service';
import { diaDeFechaDb, diaEcuador, diasEntre, fechaDb, horaEcuador } from './dia-ecuador';

const MAX_DIAS_EXPORTAR = 120;
const MARCA_CAMBIO = 'La marca cambió (otro técnico la modificó): no se quitó';

const CON_QUIEN_MARCO = {
  entradaPor: { select: { nombres: true, apellidos: true } },
  salidaPor: { select: { nombres: true, apellidos: true } },
} as const;

type Persona = { nombres: string; apellidos: string } | null;
const nombre = (p: Persona) => (p ? `${p.nombres} ${p.apellidos}` : null);

/**
 * Asistencia diaria de los operadores CDA: un check de entrada y otro de
 * salida por día. Solo se marca el día de hoy (hora de Ecuador) y nunca se
 * pisa una marca existente: si dos técnicos marcan a la vez, gana el primero.
 */
@Injectable()
export class AsistenciaCdaService {
  constructor(private readonly prisma: PrismaService) {}

  async dia(fecha?: string): Promise<AsistenciaCdaDia> {
    const hoy = diaEcuador();
    const dia = fecha ? parsearDia(fecha) : hoy;
    if (dia > hoy) throw new BadRequestException('No se puede consultar la asistencia de un día futuro');
    const [operadores, asistencias] = await Promise.all([
      this.prisma.operadorCda.findMany({ where: { activo: true }, orderBy: { apellidosNombres: 'asc' } }),
      this.prisma.asistenciaCda.findMany({ where: { fecha: fechaDb(dia) }, include: CON_QUIEN_MARCO }),
    ]);
    const porOperador = new Map(asistencias.map((a) => [a.operadorId, a]));
    return {
      fecha: dia,
      esHoy: dia === hoy,
      filas: operadores.map((o) => {
        const a = porOperador.get(o.id);
        return {
          operador: toOperadorCdaDto(o),
          entradaEn: a?.entradaEn?.toISOString() ?? null,
          entradaPor: nombre(a?.entradaPor ?? null),
          salidaEn: a?.salidaEn?.toISOString() ?? null,
          salidaPor: nombre(a?.salidaPor ?? null),
        };
      }),
    };
  }

  async marcar(operadorId: string, tipo: TipoMarcaAsistenciaCda, usuarioId: string): Promise<AsistenciaCdaFila> {
    const operador = await this.operadorActivo(operadorId);
    // El día sale de la misma hora que se guarda (cerca de medianoche no deben diferir).
    const ahora = new Date();
    const fecha = fechaDb(diaEcuador(ahora));
    const fila = await this.prisma.asistenciaCda.upsert({
      where: { operadorId_fecha: { operadorId, fecha } },
      create: { operadorId, fecha },
      update: {},
    });
    const { count } =
      tipo === 'ENTRADA'
        ? await this.prisma.asistenciaCda.updateMany({
            where: { id: fila.id, entradaEn: null },
            data: { entradaEn: ahora, entradaPorId: usuarioId },
          })
        : await this.prisma.asistenciaCda.updateMany({
            where: { id: fila.id, entradaEn: { not: null }, salidaEn: null },
            data: { salidaEn: ahora, salidaPorId: usuarioId },
          });

    const actual = await this.prisma.asistenciaCda.findUniqueOrThrow({ where: { id: fila.id }, include: CON_QUIEN_MARCO });
    if (count === 0) {
      if (tipo === 'SALIDA' && !actual.entradaEn) throw new ConflictException('Primero registre la entrada de hoy');
      const marca = tipo === 'ENTRADA' ? actual.entradaEn : actual.salidaEn;
      const quien = nombre(tipo === 'ENTRADA' ? actual.entradaPor : actual.salidaPor);
      throw new ConflictException(
        `La ${tipo === 'ENTRADA' ? 'entrada' : 'salida'} de hoy ya estaba registrada` +
          (marca ? ` a las ${horaEcuador(marca)}${quien ? ` por ${quien}` : ''}` : ''),
      );
    }
    return {
      operador: toOperadorCdaDto(operador),
      entradaEn: actual.entradaEn?.toISOString() ?? null,
      entradaPor: nombre(actual.entradaPor),
      salidaEn: actual.salidaEn?.toISOString() ?? null,
      salidaPor: nombre(actual.salidaPor),
    };
  }

  /**
   * Quita una marca de hoy (corrección o "Deshacer"). La entrada solo si no hay
   * salida. Con `soloSi` (ISO de la marca que se vio) no quita una marca más
   * nueva que otro técnico haya puesto entretanto. Devuelve la marca quitada
   * para la bitácora (la fila ya no la conserva).
   */
  async deshacer(
    operadorId: string,
    tipo: TipoMarcaAsistenciaCda,
    soloSi?: string,
  ): Promise<{ deshecho: true; marcaEn: string; marcadaPorId: string | null }> {
    const fecha = fechaDb(diaEcuador());
    const fila = await this.prisma.asistenciaCda.findUnique({ where: { operadorId_fecha: { operadorId, fecha } } });
    const marca = tipo === 'ENTRADA' ? fila?.entradaEn : fila?.salidaEn;
    const marcadaPorId = (tipo === 'ENTRADA' ? fila?.entradaPorId : fila?.salidaPorId) ?? null;
    if (!fila || !marca) throw new NotFoundException(`No hay ${tipo === 'ENTRADA' ? 'entrada' : 'salida'} registrada hoy`);
    if (soloSi !== undefined && marca.toISOString() !== soloSi) throw new ConflictException(MARCA_CAMBIO);

    const { count } =
      tipo === 'ENTRADA'
        ? await this.prisma.asistenciaCda.updateMany({
            where: { id: fila.id, entradaEn: marca, salidaEn: null },
            data: { entradaEn: null, entradaPorId: null },
          })
        : await this.prisma.asistenciaCda.updateMany({
            where: { id: fila.id, salidaEn: marca },
            data: { salidaEn: null, salidaPorId: null },
          });
    if (count === 0) {
      throw new ConflictException(tipo === 'ENTRADA' && fila.salidaEn ? 'Primero quite la salida de hoy' : MARCA_CAMBIO);
    }
    return { deshecho: true, marcaEn: marca.toISOString(), marcadaPorId };
  }

  /** Marca a varios a la vez; los que ya tenían la marca (o no tienen entrada, para la salida) se omiten. */
  async marcarMasiva(
    tipo: TipoMarcaAsistenciaCda,
    operadorIds: string[],
    usuarioId: string,
  ): Promise<MarcarAsistenciaCdaMasivaResult> {
    const unicos = [...new Set(operadorIds)];
    const activos = (
      await this.prisma.operadorCda.findMany({ where: { id: { in: unicos }, activo: true }, select: { id: true } })
    ).map((o) => o.id);
    const ahora = new Date();
    const fecha = fechaDb(diaEcuador(ahora));

    const { count } =
      tipo === 'ENTRADA'
        ? await this.prisma.$transaction(async (tx) => {
            await tx.asistenciaCda.createMany({
              data: activos.map((operadorId) => ({ operadorId, fecha })),
              skipDuplicates: true,
            });
            return tx.asistenciaCda.updateMany({
              where: { fecha, operadorId: { in: activos }, entradaEn: null },
              data: { entradaEn: ahora, entradaPorId: usuarioId },
            });
          })
        : await this.prisma.asistenciaCda.updateMany({
            where: { fecha, operadorId: { in: activos }, entradaEn: { not: null }, salidaEn: null },
            data: { salidaEn: ahora, salidaPorId: usuarioId },
          });
    return { marcados: count, omitidos: activos.length - count, ignorados: unicos.length - activos.length };
  }

  /** Excel con una fila por operador y día (desde su fecha de inicio). */
  async exportar(desdeParam?: string, hastaParam?: string): Promise<Buffer> {
    const hoy = diaEcuador();
    const hasta = hastaParam ? parsearDia(hastaParam) : hoy;
    if (hasta > hoy) throw new BadRequestException('La fecha final no puede ser futura');
    const operadores = await this.prisma.operadorCda.findMany({
      where: { activo: true },
      orderBy: { apellidosNombres: 'asc' },
    });
    const primerInicio = operadores
      .map((o) => (o.fechaInicio ? diaDeFechaDb(o.fechaInicio) : null))
      .filter((d): d is string => !!d)
      .sort()[0];
    // Sin `desde`: desde el primer día de trabajo, pero como mucho los últimos
    // 120 días (si no, pasado ese tiempo el botón de la web siempre fallaría).
    const minimo = diaDeFechaDb(new Date(fechaDb(hasta).getTime() - (MAX_DIAS_EXPORTAR - 1) * 86_400_000));
    const desde = desdeParam ? parsearDia(desdeParam) : [primerInicio ?? hasta, minimo].sort()[1];
    if (desde > hasta) throw new BadRequestException('La fecha inicial es posterior a la final');
    const dias = diasEntre(desde, hasta);
    if (dias.length > MAX_DIAS_EXPORTAR) {
      throw new BadRequestException(`El rango es demasiado largo (máximo ${MAX_DIAS_EXPORTAR} días)`);
    }

    const asistencias = await this.prisma.asistenciaCda.findMany({
      where: { fecha: { gte: fechaDb(desde), lte: fechaDb(hasta) } },
      include: CON_QUIEN_MARCO,
    });
    const clave = (operadorId: string, dia: string) => `${operadorId}|${dia}`;
    const porClave = new Map(asistencias.map((a) => [clave(a.operadorId, diaDeFechaDb(a.fecha)), a]));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Asistencia');
    ws.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Apellidos y nombres', key: 'nombre', width: 40 },
      { header: 'Cédula', key: 'cedula', width: 13 },
      { header: 'Entrada', key: 'entrada', width: 9 },
      { header: 'Registró entrada', key: 'entradaPor', width: 28 },
      { header: 'Salida', key: 'salida', width: 9 },
      { header: 'Registró salida', key: 'salidaPor', width: 28 },
      { header: 'Estado', key: 'estado', width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const dia of dias) {
      for (const o of operadores) {
        if (o.fechaInicio && diaDeFechaDb(o.fechaInicio) > dia) continue;
        const a = porClave.get(clave(o.id, dia));
        ws.addRow({
          fecha: dia,
          nombre: o.apellidosNombres,
          cedula: o.cedula,
          entrada: a?.entradaEn ? horaEcuador(a.entradaEn) : '',
          entradaPor: nombre(a?.entradaPor ?? null) ?? '',
          salida: a?.salidaEn ? horaEcuador(a.salidaEn) : '',
          salidaPor: nombre(a?.salidaPor ?? null) ?? '',
          estado: a?.salidaEn ? 'Completa' : a?.entradaEn ? 'Falta salida' : 'Sin registro',
        });
      }
    }
    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  }

  private async operadorActivo(id: string) {
    const operador = await this.prisma.operadorCda.findUnique({ where: { id } });
    if (!operador || !operador.activo) throw new NotFoundException('Operador no encontrado');
    return operador;
  }
}

function parsearDia(dia: unknown): string {
  const r = diaAsistenciaSchema.safeParse(dia);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Fecha inválida');
  return r.data;
}
