import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type {
  EstadisticaEnlace,
  EstadisticasEnlacesResponse,
  PeriodoEstadisticasEnlaces,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { TelegramNotifier, type TarjetaEstadisticas } from './telegram-notifier';
import { codigosExcluidos } from './codigos-excluidos';

const CONFIG_ID = 1;
const PERIODOS: readonly PeriodoEstadisticasEnlaces[] = ['dia', 'semana', 'mes'];
const TITULO_ACTUAL: Record<PeriodoEstadisticasEnlaces, string> = {
  dia: 'Hoy',
  semana: 'Esta semana',
  mes: 'Este mes',
};
const MS_MINUTO = 60_000;
const MS_DIA = 24 * 60 * MS_MINUTO;
// Ecuador continental no tiene horario de verano: UTC-5 todo el año.
const OFFSET_ECUADOR_MS = -5 * 60 * MS_MINUTO;

export interface Rango {
  desde: Date;
  hasta: Date;
}

/** Día de calendario en Ecuador como [año, mes(0-11), día] a partir de un instante. */
function diaEcuador(d: Date): [number, number, number] {
  const local = new Date(d.getTime() + OFFSET_ECUADOR_MS);
  return [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()];
}

/** Medianoche de Ecuador de ese día de calendario, como instante UTC. */
function medianocheEcuador(anio: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes, dia) - OFFSET_ECUADOR_MS);
}

/** "YYYY-MM-DD" → día de calendario; null si no es una fecha real. */
export function parsearFecha(texto: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return null;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const d = new Date(Date.UTC(anio, mes, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes || d.getUTCDate() !== dia) return null;
  return [anio, mes, dia];
}

/**
 * Período de calendario en hora de Ecuador que contiene `dia`: el día, la
 * semana de lunes a domingo, o el mes. `hasta` es exclusivo.
 */
export function rangoPeriodo(periodo: PeriodoEstadisticasEnlaces, [anio, mes, dia]: [number, number, number]): Rango {
  if (periodo === 'mes') {
    return { desde: medianocheEcuador(anio, mes, 1), hasta: medianocheEcuador(anio, mes + 1, 1) };
  }
  if (periodo === 'semana') {
    const diaSemana = (new Date(Date.UTC(anio, mes, dia)).getUTCDay() + 6) % 7; // lunes = 0
    const desde = medianocheEcuador(anio, mes, dia - diaSemana);
    return { desde, hasta: new Date(desde.getTime() + 7 * MS_DIA) };
  }
  const desde = medianocheEcuador(anio, mes, dia);
  return { desde, hasta: new Date(desde.getTime() + MS_DIA) };
}

/** Valida `?periodo=&fecha=` del endpoint (400 si algo no es válido). */
export function filtroEstadisticas(
  periodo: unknown,
  fecha: unknown,
  ahora = new Date(),
): { periodo: PeriodoEstadisticasEnlaces; dia: [number, number, number] } {
  const p = periodo === undefined ? 'dia' : periodo;
  if (typeof p !== 'string' || !PERIODOS.includes(p as PeriodoEstadisticasEnlaces)) {
    throw new BadRequestException('periodo debe ser dia, semana o mes');
  }
  if (fecha === undefined) return { periodo: p as PeriodoEstadisticasEnlaces, dia: diaEcuador(ahora) };
  const dia = typeof fecha === 'string' ? parsearFecha(fecha) : null;
  if (!dia) throw new BadRequestException('fecha debe tener el formato AAAA-MM-DD');
  return { periodo: p as PeriodoEstadisticasEnlaces, dia };
}

interface Caida {
  codigoRecinto: string;
  nombreRecinto: string;
  canton: string | null;
  inicio: Date;
  fin: Date | null;
}

interface Recinto {
  codigoRecinto: string;
  nombreRecinto: string;
  canton: string | null;
}

/**
 * Por recinto: caídas que empezaron en el rango, minutos caído dentro del
 * rango (las abiertas cuentan hasta `ahora`) y % de disponibilidad sobre el
 * tiempo observado (desde que hay historial y hasta ahora).
 */
export function calcularEstadisticas(
  caidas: Caida[],
  recintos: Recinto[],
  rango: Rango,
  historialDesde: Date,
  ahora: Date,
): Pick<EstadisticasEnlacesResponse, 'datosParciales' | 'totalRecintos' | 'ranking' | 'sinCaidas'> {
  const inicioObservado = Math.max(rango.desde.getTime(), historialDesde.getTime());
  const finObservado = Math.min(rango.hasta.getTime(), ahora.getTime());
  const minutosObservados = Math.max(0, (finObservado - inicioObservado) / MS_MINUTO);

  const porRecinto = new Map<string, EstadisticaEnlace>();
  for (const c of caidas) {
    const desde = Math.max(c.inicio.getTime(), rango.desde.getTime());
    const hasta = Math.min((c.fin ?? ahora).getTime(), rango.hasta.getTime(), ahora.getTime());
    // `< ahora`: al comparar "a esta hora", lo que empezó después del corte no cuenta.
    const empezoEnRango = c.inicio >= rango.desde && c.inicio < rango.hasta && c.inicio < ahora;
    if (hasta <= desde && !empezoEnRango) continue;

    const e =
      porRecinto.get(c.codigoRecinto) ??
      ({
        codigoRecinto: c.codigoRecinto,
        nombreRecinto: c.nombreRecinto,
        canton: c.canton ?? '',
        caidas: 0,
        minutosCaido: 0,
        disponibilidad: 100,
        sigueCaido: false,
      } satisfies EstadisticaEnlace);
    if (empezoEnRango) e.caidas += 1;
    e.minutosCaido += Math.max(0, hasta - desde) / MS_MINUTO;
    if (!c.fin) e.sigueCaido = true;
    porRecinto.set(c.codigoRecinto, e);
  }

  const ranking = [...porRecinto.values()]
    .map((e) => ({
      ...e,
      minutosCaido: Math.round(e.minutosCaido),
      disponibilidad:
        minutosObservados > 0
          ? Math.max(0, Math.round((1 - e.minutosCaido / minutosObservados) * 1000) / 10)
          : 100,
    }))
    .sort(
      (a, b) =>
        b.caidas - a.caidas || b.minutosCaido - a.minutosCaido || a.codigoRecinto.localeCompare(b.codigoRecinto),
    );

  const sinCaidas = recintos
    .filter((r) => !porRecinto.has(r.codigoRecinto))
    .map((r) => ({ codigoRecinto: r.codigoRecinto, nombreRecinto: r.nombreRecinto, canton: r.canton ?? '' }))
    .sort((a, b) => a.codigoRecinto.localeCompare(b.codigoRecinto, 'es', { numeric: true }));

  return {
    datosParciales: historialDesde > rango.desde,
    totalRecintos: recintos.length,
    ranking,
    sinCaidas,
  };
}

@Injectable()
export class EnlacesEstadisticasService {
  private readonly log = new Logger('EnlacesEstadisticas');

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramNotifier,
  ) {}

  async estadisticas(
    periodo: PeriodoEstadisticasEnlaces,
    dia: [number, number, number],
    ahora = new Date(),
  ): Promise<EstadisticasEnlacesResponse> {
    const rango = rangoPeriodo(periodo, dia);
    const [caidas, recintos, config] = await Promise.all([
      this.prisma.enlaceCaida.findMany({
        where: {
          // El historial guarda caídas del CPE de antes de excluirlo.
          codigoRecinto: { notIn: codigosExcluidos() },
          inicio: { lt: rango.hasta },
          OR: [{ fin: null }, { fin: { gt: rango.desde } }],
        },
        select: { codigoRecinto: true, nombreRecinto: true, canton: true, inicio: true, fin: true },
      }),
      this.prisma.enlaceRecinto.findMany({
        select: { codigoRecinto: true, nombreRecinto: true, canton: true },
      }),
      this.prisma.configEnlaces.findUnique({ where: { id: CONFIG_ID }, select: { historialDesde: true } }),
    ]);
    // Sin fila de configuración no hay historial previo: cuenta desde ahora.
    const historialDesde = config?.historialDesde ?? ahora;
    return {
      periodo,
      desde: rango.desde.toISOString(),
      hasta: rango.hasta.toISOString(),
      historialDesde: historialDesde.toISOString(),
      ...calcularEstadisticas(caidas, recintos, rango, historialDesde, ahora),
    };
  }

  /**
   * El período y, para comparar, el anterior (ayer, la semana o el mes
   * anterior), solo si el historial lo cubre completo: comparar contra un
   * período a medias daría "más caídas que ayer" falsos. Si el período sigue
   * en curso, el anterior se corta a la misma altura (hoy hasta las 09:00 contra
   * ayer hasta las 09:00), no contra el día entero.
   */
  async tarjeta(
    titulo: string,
    periodo: PeriodoEstadisticasEnlaces,
    dia: [number, number, number],
    ahora = new Date(),
  ): Promise<TarjetaEstadisticas> {
    const actual = await this.estadisticas(periodo, dia, ahora);
    const comparaHastaAhora = ahora < new Date(actual.hasta);
    if (actual.datosParciales) return { titulo, actual, anterior: null, comparaHastaAhora };
    const desdeActual = new Date(actual.desde).getTime();
    const diaAnterior = diaEcuador(new Date(desdeActual - 1));
    const desdeAnterior = rangoPeriodo(periodo, diaAnterior).desde.getTime();
    const corte = comparaHastaAhora ? new Date(ahora.getTime() - (desdeActual - desdeAnterior)) : ahora;
    const anterior = await this.estadisticas(periodo, diaAnterior, corte);
    return { titulo, actual, anterior: anterior.datosParciales ? null : anterior, comparaHastaAhora };
  }

  /** Botón "📊 Estadísticas": la tarjeta de hoy (o del período que pidió el asistente),
   * con botones para cambiar entre hoy, la semana y el mes. */
  async enviarEstadisticasTelegram(ahora = new Date(), periodo: PeriodoEstadisticasEnlaces = 'dia'): Promise<void> {
    const tarjeta = await this.tarjeta(TITULO_ACTUAL[periodo], periodo, diaEcuador(ahora), ahora);
    await this.telegram.enviarTarjetaEstadisticas(tarjeta, true);
  }

  /** Botón Hoy/Semana/Mes bajo una tarjeta: la cambia, en el mismo mensaje, por ese período. */
  async mostrarPeriodoTelegram(
    periodo: PeriodoEstadisticasEnlaces,
    messageId: number,
    ahora = new Date(),
  ): Promise<void> {
    const tarjeta = await this.tarjeta(TITULO_ACTUAL[periodo], periodo, diaEcuador(ahora), ahora);
    await this.telegram.editarTarjetaEstadisticas(messageId, tarjeta);
  }

  /**
   * Resumen automático a las 08:00 (hora de Ecuador): la tarjeta del día
   * anterior; los lunes también la de la semana anterior y el día 1 la del mes
   * anterior. Sin botones: es un registro de ese período, no se cambia. Se
   * apaga junto con el cron de enlaces (ENLACES_CRON_ENABLED=false).
   */
  @Cron('0 8 * * *', { name: 'resumen-enlaces', timeZone: 'America/Guayaquil' })
  async enviarResumenProgramado(ahora = new Date()): Promise<void> {
    if (process.env.ENLACES_CRON_ENABLED?.trim().toLowerCase() === 'false') return;
    try {
      const ayer = diaEcuador(new Date(ahora.getTime() - MS_DIA));
      const [anio, mes, dia] = diaEcuador(ahora);
      const periodos: [string, PeriodoEstadisticasEnlaces][] = [['Ayer', 'dia']];
      if (new Date(Date.UTC(anio, mes, dia)).getUTCDay() === 1) periodos.push(['Semana pasada', 'semana']);
      if (dia === 1) periodos.push(['Mes pasado', 'mes']);

      // Se calculan todas antes de enviar: si algo falla, no queda un resumen a medias.
      const tarjetas: TarjetaEstadisticas[] = [];
      for (const [titulo, periodo] of periodos) tarjetas.push(await this.tarjeta(titulo, periodo, ayer, ahora));
      for (const t of tarjetas) await this.telegram.enviarTarjetaEstadisticas(t, false);
      this.log.log(`Resumen de enlaces enviado (${periodos.map(([t]) => t).join(', ')})`);
    } catch (e) {
      this.log.error(`No se pudo armar el resumen de enlaces: ${(e as Error)?.message ?? e}`);
    }
  }
}
