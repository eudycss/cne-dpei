import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { diaAsistenciaSchema } from '@cne/shared-validation';
import type {
  AsistenciaCdaDia,
  AsistenciaCdaFila,
  CorregirAsistenciaCdaRequest,
  CorregirAsistenciaCdaResult,
  FormatoReporteCda,
  GrupoCda,
  MarcarAsistenciaCdaMasivaResult,
  OrigenMarcaCda,
  TipoMarcaAsistenciaCda,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { TEXTOS_GRUPO } from './grupo-cda';
import { toOperadorCdaDto } from './operadores-cda.service';
import { diaDeFechaDb, diaEcuador, diasEntre, fechaDb, horaEcuador, momentoEcuador } from './dia-ecuador';
import { enTramos, personalDelCargo } from './periodos-cargo';
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

const MAX_DIAS_EXPORTAR = 120;
const MARCA_CAMBIO = 'La marca cambió (otro técnico la modificó): no se quitó';
const CORRECCION_CRUZADA = 'La asistencia de ese día cambió mientras la corregía: vuelva a abrirla';

const CON_QUIEN_MARCO = {
  entradaPor: { select: { nombres: true, apellidos: true } },
  salidaPor: { select: { nombres: true, apellidos: true } },
} as const;

const N: ColumnaReporte = { titulo: 'N.º', ancho: 6 };
const FECHA: ColumnaReporte = { titulo: 'Fecha', ancho: 12 };

/** Columnas del reporte; en el general va además "Fecha" al inicio. */
const COLUMNAS: ColumnaReporte[] = [
  N,
  { titulo: 'Apellidos y nombres', ancho: 40 },
  { titulo: 'Cédula', ancho: 13 },
  { titulo: 'Entrada', ancho: 9 },
  { titulo: 'Registró entrada', ancho: 28 },
  { titulo: 'Salida', ancho: 9 },
  { titulo: 'Registró salida', ancho: 28 },
  { titulo: 'Estado', ancho: 14 },
];

/** Quienes no registraron entrada; el N.º es el de la tabla del día. */
const COLUMNAS_FALTARON: ColumnaReporte[] = [
  N,
  { titulo: 'Apellidos y nombres', ancho: 40 },
  { titulo: 'Cédula', ancho: 13 },
  { titulo: 'Teléfono', ancho: 14 },
];

const columnasResumenDia = (grupo: GrupoCda): ColumnaReporte[] => [
  FECHA,
  { titulo: 'Día', ancho: 34 },
  { titulo: TEXTOS_GRUPO[grupo].contador, ancho: 13 },
  { titulo: 'Entrada', ancho: 11 },
  { titulo: 'Salida', ancho: 11 },
];

type FilaExportada = {
  fecha: string;
  /** Empieza con el N.º: la posición en la lista del día (1, 2, 3…). */
  celdas: Celda[];
  conEntrada: boolean;
  conSalida: boolean;
  faltante: Celda[];
};

/**
 * "Operadores 60/64 · Entrada 60/64 · Salida 58/64". El primero (Operadores o
 * Asistentes) cuenta a los que asistieron, es decir, los que registraron
 * entrada: por decisión del usuario coincide siempre con "Entrada".
 */
export function contadoresDelDia(filas: Pick<FilaExportada, 'conEntrada' | 'conSalida'>[]): {
  asistieron: string;
  entrada: string;
  salida: string;
} {
  const total = filas.length;
  const entrada = filas.filter((f) => f.conEntrada).length;
  const salida = filas.filter((f) => f.conSalida).length;
  return { asistieron: `${entrada}/${total}`, entrada: `${entrada}/${total}`, salida: `${salida}/${total}` };
}

function textoContadores(filas: FilaExportada[], grupo: GrupoCda): string {
  const c = contadoresDelDia(filas);
  return `${TEXTOS_GRUPO[grupo].contador} ${c.asistieron} · Entrada ${c.entrada} · Salida ${c.salida}`;
}

const tituloFaltaron = (n: number) => `Sin registro de entrada / Faltaron: ${n === 0 ? 'ninguno' : n}`;

/** Hoy todavía pueden llegar: "Sin entrada"; un día pasado sin entrada es "Faltó". */
function estado(entrada: boolean, salida: boolean, esHoy: boolean): string {
  if (salida) return 'Completa';
  if (entrada) return 'Sin salida';
  return esHoy ? 'Sin entrada' : 'Faltó';
}

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

  async dia(fecha?: string, grupo: GrupoCda = 'OPERADOR'): Promise<AsistenciaCdaDia> {
    const hoy = diaEcuador();
    const dia = fecha ? parsearDia(fecha) : hoy;
    if (dia > hoy) throw new BadRequestException('No se puede consultar la asistencia de un día futuro');
    // Quien cambió de cargo sale en el cargo que tenía ese día.
    const operadores = (await personalDelCargo(this.prisma, grupo))
      .filter((p) => enTramos(p.tramos, dia))
      .map((p) => p.operador);
    const asistencias = await this.prisma.asistenciaCda.findMany({
      where: { fecha: fechaDb(dia), operadorId: { in: operadores.map((o) => o.id) } },
      include: CON_QUIEN_MARCO,
    });
    const porOperador = new Map<string, (typeof asistencias)[number]>(asistencias.map((a) => [a.operadorId, a]));
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

  async marcar(
    operadorId: string,
    tipo: TipoMarcaAsistenciaCda,
    usuarioId: string,
    origen: OrigenMarcaCda = 'MANUAL',
  ): Promise<AsistenciaCdaFila> {
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
            data: { entradaEn: ahora, entradaPorId: usuarioId, entradaOrigen: origen },
          })
        : await this.prisma.asistenciaCda.updateMany({
            where: { id: fila.id, entradaEn: { not: null }, salidaEn: null },
            data: { salidaEn: ahora, salidaPorId: usuarioId, salidaOrigen: origen },
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
            data: { entradaEn: null, entradaPorId: null, entradaOrigen: null },
          })
        : await this.prisma.asistenciaCda.updateMany({
            where: { id: fila.id, salidaEn: marca },
            data: { salidaEn: null, salidaPorId: null, salidaOrigen: null },
          });
    if (count === 0) {
      throw new ConflictException(tipo === 'ENTRADA' && fila.salidaEn ? 'Primero quite la salida de hoy' : MARCA_CAMBIO);
    }
    return { deshecho: true, marcaEn: marca.toISOString(), marcadaPorId };
  }

  /**
   * Corrige un día pasado (acción aparte, con motivo para la bitácora): deja la
   * entrada y la salida como se indican. Solo se reescribe la marca que cambia,
   * que queda a nombre de quien corrige y con origen CORRECCION.
   */
  async corregir(
    operadorId: string,
    diaParam: string,
    body: CorregirAsistenciaCdaRequest,
    usuarioId: string,
  ): Promise<CorregirAsistenciaCdaResult> {
    const dia = parsearDia(diaParam);
    if (dia >= diaEcuador()) {
      throw new BadRequestException('Solo se corrigen días pasados: la asistencia de hoy se marca o se quita en la lista');
    }
    // Solo personal activo: es lo que muestra la lista del día (a un oculto se le reactiva primero).
    const operador = await this.operadorActivo(operadorId);
    if (operador.fechaInicio && dia < diaDeFechaDb(operador.fechaInicio)) {
      throw new BadRequestException('Ese día es anterior a su fecha de ingreso');
    }

    const fecha = fechaDb(dia);
    const entradaEn = body.entrada ? momentoEcuador(dia, body.entrada) : null;
    const salidaEn = body.salida ? momentoEcuador(dia, body.salida) : null;
    const previa = await this.prisma.asistenciaCda.findUnique({ where: { operadorId_fecha: { operadorId, fecha } } });
    // A minuto: las marcas reales llevan segundos y el formulario solo HH:MM; la que no se tocó no se reescribe.
    const minuto = (d: Date | null | undefined) => (d ? Math.floor(d.getTime() / 60_000) : null);
    const igual = (a: Date | null | undefined, b: Date | null) => minuto(a) === minuto(b);
    const cambiaEntrada = !igual(previa?.entradaEn, entradaEn);
    const cambiaSalida = !igual(previa?.salidaEn, salidaEn);
    if (!cambiaEntrada && !cambiaSalida) throw new BadRequestException('No hay cambios: la asistencia ya está así');

    const data = {
      ...(cambiaEntrada && {
        entradaEn,
        entradaPorId: entradaEn ? usuarioId : null,
        entradaOrigen: entradaEn ? ('CORRECCION' satisfies OrigenMarcaCda) : null,
      }),
      ...(cambiaSalida && {
        salidaEn,
        salidaPorId: salidaEn ? usuarioId : null,
        salidaOrigen: salidaEn ? ('CORRECCION' satisfies OrigenMarcaCda) : null,
      }),
    };
    // Control optimista: solo se escribe si la fila sigue como se leyó, así "antes" (bitácora) es exacto.
    if (previa) {
      const { count } = await this.prisma.asistenciaCda.updateMany({
        where: { id: previa.id, entradaEn: previa.entradaEn, salidaEn: previa.salidaEn },
        data,
      });
      if (count === 0) throw new ConflictException(CORRECCION_CRUZADA);
    } else {
      try {
        await this.prisma.asistenciaCda.create({ data: { operadorId, fecha, ...data } });
      } catch (e) {
        if ((e as { code?: string } | null)?.code === 'P2002') throw new ConflictException(CORRECCION_CRUZADA);
        throw e;
      }
    }
    const fila = await this.prisma.asistenciaCda.findUniqueOrThrow({
      where: { operadorId_fecha: { operadorId, fecha } },
      include: CON_QUIEN_MARCO,
    });
    return {
      fila: {
        operador: toOperadorCdaDto(operador),
        entradaEn: fila.entradaEn?.toISOString() ?? null,
        entradaPor: nombre(fila.entradaPor),
        salidaEn: fila.salidaEn?.toISOString() ?? null,
        salidaPor: nombre(fila.salidaPor),
      },
      antes: { entradaEn: previa?.entradaEn?.toISOString() ?? null, salidaEn: previa?.salidaEn?.toISOString() ?? null },
    };
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
              data: { entradaEn: ahora, entradaPorId: usuarioId, entradaOrigen: 'MASIVA' },
            });
          })
        : await this.prisma.asistenciaCda.updateMany({
            where: { fecha, operadorId: { in: activos }, entradaEn: { not: null }, salidaEn: null },
            data: { salidaEn: ahora, salidaPorId: usuarioId, salidaOrigen: 'MASIVA' },
          });
    return { marcados: count, omitidos: activos.length - count, ignorados: unicos.length - activos.length };
  }

  /**
   * Excel o PDF con una fila por operador y día (desde su fecha de inicio):
   * todo en una tabla (GENERAL) o una hoja/sección por día (POR_DIA).
   */
  async exportar(
    desdeParam: string | undefined,
    hastaParam: string | undefined,
    modoParam: unknown,
    formato: FormatoReporteCda,
    grupo: GrupoCda = 'OPERADOR',
  ): Promise<ArchivoReporte> {
    const modo = parsearModo(modoParam);
    const hoy = diaEcuador();
    const hasta = hastaParam ? parsearDia(hastaParam) : hoy;
    if (hasta > hoy) throw new BadRequestException('La fecha final no puede ser futura');
    const personal = await personalDelCargo(this.prisma, grupo);
    const operadores = personal.map((p) => p.operador);
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
      where: { fecha: { gte: fechaDb(desde), lte: fechaDb(hasta) }, operadorId: { in: operadores.map((o) => o.id) } },
      include: CON_QUIEN_MARCO,
    });
    const clave = (operadorId: string, dia: string) => `${operadorId}|${dia}`;
    const porClave = new Map<string, (typeof asistencias)[number]>(
      asistencias.map((a) => [clave(a.operadorId, diaDeFechaDb(a.fecha)), a]),
    );

    const filas: FilaExportada[] = [];
    for (const dia of dias) {
      let numero = 0;
      for (const { operador: o, tramos } of personal) {
        if (o.fechaInicio && diaDeFechaDb(o.fechaInicio) > dia) continue;
        // Antes o después de un cambio de cargo, ese día cuenta en el otro cargo.
        if (!enTramos(tramos, dia)) continue;
        const a = porClave.get(clave(o.id, dia));
        const conEntrada = !!a?.entradaEn;
        const conSalida = !!a?.salidaEn;
        numero++;
        filas.push({
          fecha: dia,
          celdas: [
            numero,
            o.apellidosNombres,
            o.cedula,
            a?.entradaEn ? horaEcuador(a.entradaEn) : '',
            nombre(a?.entradaPor ?? null) ?? '',
            a?.salidaEn ? horaEcuador(a.salidaEn) : '',
            nombre(a?.salidaPor ?? null) ?? '',
            estado(conEntrada, conSalida, dia === hoy),
          ],
          conEntrada,
          conSalida,
          faltante: [numero, o.apellidosNombres, o.cedula, o.telefono ?? ''],
        });
      }
    }
    const porDia = agruparPorDia(filas);
    const indicesSinEntrada = (lista: FilaExportada[]) =>
      lista.flatMap((f, i) => (f.conEntrada ? [] : [i]));
    const sinEntrada = filas.filter((f) => !f.conEntrada);

    const tablas: TablaReporte[] =
      modo === 'GENERAL'
        ? [
            {
              hoja: 'Resumen por día',
              titulo: 'Resumen por día',
              columnas: columnasResumenDia(grupo),
              filas: [...porDia].map(([dia, delDia]) => {
                const c = contadoresDelDia(delDia);
                return [dia, diaLargo(dia), c.asistieron, c.entrada, c.salida];
              }),
            },
            {
              hoja: 'Asistencia',
              titulo: `Detalle por ${TEXTOS_GRUPO[grupo].singular} y día`,
              columnas: [FECHA, ...COLUMNAS],
              filas: filas.map((f) => [f.fecha, ...f.celdas]),
              resaltadas: indicesSinEntrada(filas),
            },
            {
              hoja: 'Faltaron',
              titulo: tituloFaltaron(sinEntrada.length),
              columnas: [FECHA, ...COLUMNAS_FALTARON],
              filas: sinEntrada.map((f) => [f.fecha, ...f.faltante]),
            },
          ]
        : [...porDia].map(([dia, delDia]) => {
            const faltaron = delDia.filter((f) => !f.conEntrada);
            return {
              hoja: dia,
              titulo: `${diaLargo(dia)} · ${textoContadores(delDia, grupo)}`,
              columnas: COLUMNAS,
              filas: delDia.map((f) => f.celdas),
              resaltadas: indicesSinEntrada(delDia),
              anexo: {
                titulo: tituloFaltaron(faltaron.length),
                columnas: COLUMNAS_FALTARON,
                filas: faltaron.map((f) => f.faltante),
              },
            };
          });

    return generarReporte(
      {
        titulo: `Reporte de asistencia — ${TEXTOS_GRUPO[grupo].titulo}`,
        detalle: `Del ${diaCorto(desde)} al ${diaCorto(hasta)} · hora de Ecuador`,
        archivo: `asistencia_${TEXTOS_GRUPO[grupo].archivo}`,
        desde,
        hasta,
        modo,
        tablas,
      },
      formato,
    );
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
