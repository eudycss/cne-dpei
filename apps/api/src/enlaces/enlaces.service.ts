import { timingSafeEqual } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ConfigEnlacesResponse, EnlaceRecinto, PeriodoEstadisticasEnlaces } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { resolveNotifier, type EnlaceCaido } from '../auth/notifier';
import { SheetsEnlacesClient, type SheetEnlaceRow } from './sheets-enlaces.client';
import {
  abreviarCanton,
  TelegramNotifier,
  type GrupoAsignacion,
  PREFIJO_CALLBACK_ESTADISTICAS,
  TEXTO_BOTON_ASIGNACIONES,
  TEXTO_BOTON_CAIDOS,
  TEXTO_BOTON_ESTADISTICAS,
  TEXTO_BOTON_INGRESAR_CODIGO,
} from './telegram-notifier';
import { NotificationsService } from '../notifications/notifications.service';
import { EnlacesEstadisticasService } from './enlaces-estadisticas.service';
import { EnlacesEscalamientoService } from './enlaces-escalamiento.service';
import { DistributivoNoConfigurado, DistributivoTecnicosClient } from './distributivo-tecnicos.client';

const CONFIG_ID = 1;
const CANTON_MAX_LEN = 100;
/** Más bajas que esta fracción de la tabla en un solo ciclo se tratan como lectura incompleta de la hoja. */
const MAX_FRACCION_BAJAS_POR_CICLO = 0.5;

/** Subconjunto mínimo del payload de un Telegram Update que necesita el webhook. */
export interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id: number | string };
    from?: { id: number | string };
  };
  /** Toque de un botón bajo un mensaje del bot (Hoy/Semana/Mes de la tarjeta de estadísticas). */
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat?: { id: number | string } };
  };
}

/** Toques más seguidos que esto sobre el mismo mensaje se ignoran (cada uno son consultas a la base). */
const PAUSA_ENTRE_TOQUES_MS = 1500;

const CALLBACK_PERIODO = new RegExp(`^${PREFIJO_CALLBACK_ESTADISTICAS}(dia|semana|mes)$`);

/** La hoja se edita a mano y puede traer mayúsculas inconsistentes (COTACACHI vs Cotacachi); se normaliza para que el filtro/dropdown de la web no los trate como cantones distintos. */
function normalizarCanton(valor: string | null | undefined): string | null {
  const limpio = (valor ?? '').trim();
  if (!limpio) return null;
  const tituloCase = limpio.toLowerCase().replace(/(^|\s)\p{L}/gu, (letra) => letra.toUpperCase());
  return tituloCase.slice(0, CANTON_MAX_LEN);
}

/** Compara el secreto del webhook en tiempo constante — el endpoint es público y este
 * es el único gate antes de reaccionar, así que una comparación normal (que corta en
 * el primer byte distinto) filtraría cuánto del secreto acertó un atacante. */
function secretosCoinciden(recibido: string | undefined, esperado: string): boolean {
  if (!recibido) return false;
  const bufferRecibido = Buffer.from(recibido);
  const bufferEsperado = Buffer.from(esperado);
  if (bufferRecibido.length !== bufferEsperado.length) return false;
  return timingSafeEqual(bufferRecibido, bufferEsperado);
}

@Injectable()
export class EnlacesService {
  private readonly log = new Logger('EnlacesService');
  private readonly notifier = resolveNotifier();
  /** Personas (chatId:userId) que tocaron "Ingresar código" y cuyo próximo mensaje
   * de texto se interpreta como el código a buscar, en vez de ignorarse como charla
   * normal del grupo. Guarda el momento en que se marcó, para poder expirar entradas
   * de gente que tocó el botón y nunca volvió a escribir — sin TTL, cualquiera que
   * tenga el secreto del webhook podría simular toques con from.id distintos y hacer
   * crecer esto indefinidamente. Solo vive en memoria — un reinicio del proceso lo
   * limpia, lo peor que pasa es que la persona tenga que tocar el botón de nuevo. */
  private readonly esperandoCodigo = new Map<string, number>();
  private static readonly ESPERA_CODIGO_TTL_MS = 10 * 60 * 1000;
  /** Último toque de Hoy/Semana/Mes por mensaje (message_id → ms). */
  private readonly ultimoToque = new Map<number, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetsClient: SheetsEnlacesClient,
    private readonly telegram: TelegramNotifier,
    private readonly notifications: NotificationsService,
    private readonly estadisticas: EnlacesEstadisticasService,
    private readonly distributivo: DistributivoTecnicosClient,
    private readonly escalamiento: EnlacesEscalamientoService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async revisarEnlaces(): Promise<void> {
    // Una API local con su propia base, levantada tras días apagada, ve como "recién
    // caídos" enlaces que ya estaban caídos y genera avisos falsos. Activo por defecto
    // para no apagar producción por olvido; en desarrollo se desactiva explícitamente.
    this.limpiarEsperasCodigoVencidas();
    if (process.env.ENLACES_CRON_ENABLED?.trim().toLowerCase() === 'false') return;
    let filas: Awaited<ReturnType<SheetsEnlacesClient['leerEnlacesImbabura']>>;
    try {
      filas = await this.sheetsClient.leerEnlacesImbabura();
    } catch (e) {
      this.log.error(`No se pudo leer la hoja de enlaces — se mantiene el último estado conocido: ${e}`);
      return;
    }

    const caidas: EnlaceCaido[] = [];
    const recuperados: EnlaceCaido[] = [];

    for (const fila of filas) {
      try {
        const anterior = await this.prisma.enlaceRecinto.findUnique({
          where: { codigoRecinto: fila.codigoRecinto },
        });

        const canton = normalizarCanton(fila.canton);
        await this.prisma.enlaceRecinto.upsert({
          where: { codigoRecinto: fila.codigoRecinto },
          create: {
            codigoRecinto: fila.codigoRecinto,
            nombreRecinto: fila.nombreRecinto,
            canton,
            estado: fila.estado,
            estadoAnterior: null,
          },
          update: {
            nombreRecinto: fila.nombreRecinto,
            canton,
            estado: fila.estado,
            estadoAnterior: anterior?.estado ?? null,
          },
        });

        // anterior === null (primera vez que se ve este recinto) cuenta como caída:
        // si no se notifica aquí, un enlace ya caído antes de que arranque el
        // monitoreo (o tras un reset de base) queda mudo para siempre.
        const cayoAhora = fila.estado === 'FALLO' && anterior?.estado !== 'FALLO';
        if (cayoAhora) {
          caidas.push({ codigoRecinto: fila.codigoRecinto, nombreRecinto: fila.nombreRecinto, canton });
          await this.encolarAvisoInApp(fila.codigoRecinto, fila.nombreRecinto);
        }

        const seRecuperoAhora = fila.estado === 'ACTIVO' && anterior?.estado === 'FALLO';
        if (seRecuperoAhora) {
          recuperados.push({ codigoRecinto: fila.codigoRecinto, nombreRecinto: fila.nombreRecinto, canton });
        }
      } catch (e) {
        // Un error puntual (ej. dato inválido de una sola fila) no debe tumbar
        // el resto del ciclo ni perder las notificaciones ya acumuladas.
        this.log.error(`Error procesando el recinto ${fila.codigoRecinto}: ${e}`);
      }
    }

    const historial = await this.reconciliarCaidas(filas);
    await this.eliminarRecintosFueraDeLaHoja(filas);
    // Con el historial desactualizado podría avisarse de un enlace que ya volvió.
    if (historial.ok) await this.escalamiento.escalar();

    await this.notificarCaidasPorCorreo(caidas);
    await this.notificarCaidasPorTelegram(caidas, filas);
    await this.notificarRecuperadosPorCorreo(recuperados);
    await this.notificarRecuperadosPorTelegram(recuperados, historial.minutosCaido);
  }

  /** La web, /caidos y la búsqueda por código leen esta tabla, no la hoja: si un
   * recinto se borra de la hoja y aquí no se elimina, sigue apareciendo para siempre
   * con su último estado. Una lectura vacía o parcial (ej. cambiaron el texto de
   * PROVINCIA, hoja a medio editar) no debe vaciar la tabla: al repoblarse en el
   * siguiente ciclo, todo lo que siga caído se avisaría de nuevo como "recién caído".
   * Por eso, si se borraría más de la mitad de la tabla, se asume lectura incompleta. */
  private async eliminarRecintosFueraDeLaHoja(filas: { codigoRecinto: string }[]): Promise<void> {
    if (filas.length === 0) return;

    try {
      const where = { codigoRecinto: { notIn: filas.map((f) => f.codigoRecinto) } };
      const [total, aEliminar] = await Promise.all([
        this.prisma.enlaceRecinto.count(),
        this.prisma.enlaceRecinto.count({ where }),
      ]);
      if (aEliminar === 0) return;
      if (aEliminar > total * MAX_FRACCION_BAJAS_POR_CICLO) {
        this.log.warn(
          `La hoja de enlaces dejaría fuera ${aEliminar} de ${total} recintos — parece una lectura incompleta, no se elimina nada`,
        );
        return;
      }

      const { count } = await this.prisma.enlaceRecinto.deleteMany({ where });
      this.log.log(`Se eliminaron ${count} recinto(s) que ya no están en la hoja de enlaces`);
      // Un recinto que sale de la hoja deja de monitorearse: su caída abierta se
      // cierra aquí para que no siga sumando tiempo caído para siempre.
      await this.cerrarCaidas(where);
    } catch (e) {
      this.log.error(`Error eliminando recintos que ya no están en la hoja de enlaces: ${e}`);
    }
  }

  /** Historial para las estadísticas, alineado con la hoja en cada ciclo (no
   * solo en la transición): si un ciclo no pudo abrir o cerrar una caída (p. ej.
   * un corte con la base), el siguiente lo corrige. Sin esto, una caída que no se
   * cerró sumaría tiempo caído para siempre. Abre una caída para cada recinto en
   * FALLO que no tenga una abierta (el índice único parcial evita duplicados) y
   * cierra las abiertas de los que están ACTIVO. Precisión: la del cron (5 min).
   * Devuelve cuánto duró cada caída que se cerró (para "volvió tras 42 min") y
   * si el historial quedó al día. */
  private async reconciliarCaidas(
    filas: SheetEnlaceRow[],
  ): Promise<{ ok: boolean; minutosCaido: Map<string, number> }> {
    const minutosCaido = new Map<string, number>();
    try {
      const enFallo = filas.filter((f) => f.estado === 'FALLO');
      const activos = filas.filter((f) => f.estado === 'ACTIVO').map((f) => f.codigoRecinto);
      const abiertas = await this.prisma.enlaceCaida.findMany({
        where: { fin: null },
        select: { codigoRecinto: true, inicio: true },
      });
      const conCaidaAbierta = new Set<string>(abiertas.map((a) => a.codigoRecinto));
      const ahora = new Date();
      const activosSet = new Set<string>(activos);
      for (const a of abiertas) {
        if (activosSet.has(a.codigoRecinto)) {
          minutosCaido.set(a.codigoRecinto, Math.round((ahora.getTime() - a.inicio.getTime()) / 60_000));
        }
      }
      const nuevas = enFallo.filter((f) => !conCaidaAbierta.has(f.codigoRecinto));
      if (nuevas.length > 0) {
        await this.prisma.enlaceCaida.createMany({
          data: nuevas.map((f) => ({
            codigoRecinto: f.codigoRecinto,
            nombreRecinto: f.nombreRecinto,
            canton: normalizarCanton(f.canton),
            inicio: ahora,
          })),
          skipDuplicates: true,
        });
      }
      if (activos.some((c) => conCaidaAbierta.has(c))) {
        await this.cerrarCaidas({ codigoRecinto: { in: activos } });
      }
    } catch (e) {
      // El historial nunca frena los avisos; el siguiente ciclo vuelve a intentarlo.
      this.log.error(`No se pudo actualizar el historial de caídas: ${(e as Error)?.message ?? e}`);
      return { ok: false, minutosCaido };
    }
    return { ok: true, minutosCaido };
  }

  /** Cierra las caídas abiertas (sin fin) de los recintos que cumplen `where`. */
  private async cerrarCaidas(where: { codigoRecinto: { in: string[] } | { notIn: string[] } }): Promise<void> {
    try {
      await this.prisma.enlaceCaida.updateMany({ where: { ...where, fin: null }, data: { fin: new Date() } });
    } catch (e) {
      this.log.error(`No se pudo cerrar la caída de enlaces: ${(e as Error)?.message ?? e}`);
    }
  }

  /** Un solo correo con todos los recintos caídos en este ciclo, en vez de uno por recinto. */
  private async notificarCaidasPorCorreo(caidas: EnlaceCaido[]): Promise<void> {
    if (caidas.length === 0) return;

    const config = await this.prisma.configEnlaces.findUnique({ where: { id: CONFIG_ID } });
    const correos = config?.correos ?? [];
    if (correos.length === 0) return;

    try {
      await this.notifier.sendEnlaceCaido(correos, caidas);
    } catch (e) {
      const codigos = caidas.map((c) => c.codigoRecinto).join(', ');
      this.log.error(`Error enviando correo de enlaces caídos (${codigos}): ${e}`);
    }
  }

  /** Un solo correo con todos los recintos que volvieron a ACTIVO en este ciclo. */
  private async notificarRecuperadosPorCorreo(recuperados: EnlaceCaido[]): Promise<void> {
    if (recuperados.length === 0) return;

    const config = await this.prisma.configEnlaces.findUnique({ where: { id: CONFIG_ID } });
    const correos = config?.correos ?? [];
    if (correos.length === 0) return;

    try {
      await this.notifier.sendEnlaceRecuperado(correos, recuperados);
    } catch (e) {
      const codigos = recuperados.map((c) => c.codigoRecinto).join(', ');
      this.log.error(`Error enviando correo de enlaces recuperados (${codigos}): ${e}`);
    }
  }

  private async notificarRecuperadosPorTelegram(
    recuperados: EnlaceCaido[],
    minutosCaido: Map<string, number>,
  ): Promise<void> {
    if (recuperados.length === 0) return;

    try {
      await this.telegram.enviarRecuperados(recuperados, minutosCaido);
    } catch (e) {
      const codigos = recuperados.map((c) => c.codigoRecinto).join(', ');
      this.log.error(`Error enviando Telegram de enlaces recuperados (${codigos}): ${e}`);
    }
  }

  private async encolarAvisoInApp(codigoRecinto: string, nombreRecinto: string): Promise<void> {
    try {
      await this.notifications.encolarEnlaceCaido({ codigoRecinto, nombreRecinto });
    } catch (e) {
      this.log.error(`Error encolando aviso in-app de enlace caído (${codigoRecinto}): ${e}`);
    }
  }

  /** Manda a Telegram la lista COMPLETA de recintos caídos en este momento (no solo los
   * nuevos), marcando los que acaban de caer — un mensaje con solo el/los nuevo(s) haría
   * pensar al grupo que el resto ya se recuperó, cuando en realidad sigue caído. */
  private async notificarCaidasPorTelegram(
    nuevasCaidas: EnlaceCaido[],
    filas: { codigoRecinto: string; nombreRecinto: string; canton: string; estado: string }[],
  ): Promise<void> {
    if (nuevasCaidas.length === 0) return;

    try {
      const todasCaidas: EnlaceCaido[] = filas
        .filter((f) => f.estado === 'FALLO')
        .map((f) => ({
          codigoRecinto: f.codigoRecinto,
          nombreRecinto: f.nombreRecinto,
          canton: normalizarCanton(f.canton),
        }));
      const nuevosCodigos = new Set(nuevasCaidas.map((c) => c.codigoRecinto));
      await this.telegram.enviarListaActual(todasCaidas, nuevosCodigos);
    } catch (e) {
      const codigos = nuevasCaidas.map((c) => c.codigoRecinto).join(', ');
      this.log.error(`Error enviando Telegram de enlaces caídos (${codigos}): ${e}`);
    }
  }

  async list(): Promise<EnlaceRecinto[]> {
    const rows = await this.prisma.enlaceRecinto.findMany({ orderBy: { codigoRecinto: 'asc' } });
    return rows.map((r: any) => ({
      codigoRecinto: r.codigoRecinto,
      nombreRecinto: r.nombreRecinto,
      canton: r.canton ?? '',
      estado: r.estado,
      actualizadoEn: r.actualizadoEn.toISOString(),
    }));
  }

  async getConfig(): Promise<ConfigEnlacesResponse> {
    const config = await this.prisma.configEnlaces.findUnique({ where: { id: CONFIG_ID } });
    return { correos: config?.correos ?? [] };
  }

  async addCorreo(correo: string): Promise<ConfigEnlacesResponse> {
    const normalizado = correo.trim().toLowerCase();
    const actual = await this.getConfig();
    const yaExistia = actual.correos.includes(normalizado);
    const correos = yaExistia ? actual.correos : [...actual.correos, normalizado];
    const resultado = await this.guardarCorreos(correos);

    // Solo para altas reales: el cron solo notifica en la transición
    // ACTIVO→FALLO, así que sin este catch-up un correo agregado hoy queda
    // mudo sobre recintos que ya estaban caídos antes del alta, hasta que
    // se recuperen y vuelvan a caer (o para siempre si nunca se recuperan).
    if (!yaExistia) {
      await this.notificarCatchUpCaidasActuales(normalizado);
    }

    return resultado;
  }

  /** Envía al correo recién agregado el listado de recintos ya caídos EN ESE
   * MOMENTO, como "primera notificación". Ningún fallo de esta función (ni
   * la lectura de recintos caídos ni el envío) debe afectar el alta del
   * correo, que ya quedó persistida antes de llegar aquí. */
  private async notificarCatchUpCaidasActuales(correoNuevo: string): Promise<void> {
    try {
      const recintosCaidos = await this.prisma.enlaceRecinto.findMany({ where: { estado: 'FALLO' } });
      if (recintosCaidos.length === 0) return;

      const caidas: EnlaceCaido[] = recintosCaidos.map((r: any) => ({
        codigoRecinto: r.codigoRecinto,
        nombreRecinto: r.nombreRecinto,
      }));

      await this.notifier.sendEnlaceCaido([correoNuevo], caidas);
    } catch (e) {
      this.log.error(`Error enviando correo de catch-up de enlaces caídos a ${correoNuevo}: ${e}`);
    }
  }

  /** Reenvía a Telegram, bajo demanda, la lista completa de recintos caídos EN ESE
   * MOMENTO — para cuando se reconfigura el bot/grupo o se agrega gente nueva y hay
   * que ponerlos al día (Telegram no tiene el catch-up automático que sí tiene el
   * correo al agregar un destinatario). */
  async reenviarListaTelegram(): Promise<{ enviados: number }> {
    const recintosCaidos = await this.prisma.enlaceRecinto.findMany({ where: { estado: 'FALLO' } });
    const caidas: EnlaceCaido[] = recintosCaidos.map((r: any) => ({
      codigoRecinto: r.codigoRecinto,
      nombreRecinto: r.nombreRecinto,
      canton: r.canton,
    }));
    await this.telegram.enviarListaActual(caidas);
    return { enviados: caidas.length };
  }

  /** Recintos CDA agrupados por técnico, leídos del distributivo en Drive, con
   * el estado actual del enlace de cada uno. Los recintos monitoreados que no
   * están en el distributivo (p. ej. el CPE) van al final como "Sin técnico
   * asignado". */
  async enviarAsignacionesTelegram(): Promise<void> {
    const [asignaciones, enlaces] = await Promise.all([
      this.distributivo.asignaciones(),
      this.prisma.enlaceRecinto.findMany({
        select: { codigoRecinto: true, nombreRecinto: true, canton: true, estado: true },
        orderBy: { codigoRecinto: 'asc' },
      }),
    ]);
    // Genéricos explícitos: sin ellos la CI (sin `prisma generate`) infiere Map<unknown, unknown>.
    const enlacePorCodigo = new Map<string, (typeof enlaces)[number]>(enlaces.map((e) => [e.codigoRecinto, e]));

    // El número de cada técnico es el orden en que aparece en el archivo.
    const grupos = new Map<number, GrupoAsignacion>();
    for (const a of [...asignaciones].sort((x, y) => x.numeroTecnico - y.numeroTecnico)) {
      const grupo = grupos.get(a.numeroTecnico) ?? { numeroTecnico: a.numeroTecnico, tecnico: a.tecnico, recintos: [] };
      const enlace = enlacePorCodigo.get(a.codigoRecinto);
      grupo.recintos.push({
        codigoRecinto: a.codigoRecinto,
        nombreRecinto: enlace?.nombreRecinto ?? (a.localidad || 'Sin enlace monitoreado'),
        canton: enlace?.canton ?? null,
        estado: enlace?.estado ?? null,
      });
      grupos.set(a.numeroTecnico, grupo);
    }

    const asignados = new Set(asignaciones.map((a) => a.codigoRecinto));
    const sinTecnico = enlaces
      .filter((e) => !asignados.has(e.codigoRecinto))
      .map((e) => ({ codigoRecinto: e.codigoRecinto, nombreRecinto: e.nombreRecinto, canton: e.canton, estado: e.estado }));

    const lista = [...grupos.values()];
    if (sinTecnico.length > 0) lista.push({ numeroTecnico: null, tecnico: '', recintos: sinTecnico });
    if (lista.length === 0) {
      await this.telegram.enviarTexto('El distributivo no tiene asignaciones de técnicos.', 'el aviso de asignaciones vacías');
      return;
    }
    await this.telegram.enviarAsignaciones(lista);
  }

  /** Procesa un update entrante del webhook de Telegram: `/caidos` (o su botón)
   * responde con la lista actual de recintos caídos; `/estadisticas` (o su
   * botón), con la tarjeta de hoy (y botones para la semana y el mes); `/asignaciones`
   * (o su botón), con los recintos CDA por técnico; el botón "Ingresar código"
   * arranca un flujo de dos pasos donde el siguiente mensaje de esa misma persona
   * se busca como código de recinto. Cualquier otra cosa (secreto inválido, chat
   * distinto al configurado, texto que no matchea nada de esto) se ignora en
   * silencio — este endpoint es público, así que nunca debe reaccionar a tráfico
   * no confiable. */
  async procesarComandoTelegram(secretRecibido: string | undefined, update: TelegramUpdate): Promise<void> {
    const secretEsperado = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secretEsperado || !secretosCoinciden(secretRecibido, secretEsperado)) {
      this.log.warn('Webhook de Telegram: secreto ausente o inválido — se ignora el update');
      return;
    }

    if (update.callback_query) {
      await this.procesarBotonTelegram(update.callback_query);
      return;
    }

    const textoOriginal = update.message?.text?.trim();
    const texto = textoOriginal?.toLowerCase();
    const chatId = update.message?.chat?.id;
    if (!textoOriginal || !texto || chatId === undefined) return;

    const chatConfigurado = process.env.TELEGRAM_CHAT_ID;
    if (!chatConfigurado || String(chatId) !== chatConfigurado) {
      this.log.warn(`Webhook de Telegram: mensaje desde un chat no autorizado (${chatId}) — se ignora`);
      return;
    }

    // El flujo de "ingresar código" depende de identificar a la persona (chat:usuario);
    // si Telegram no manda from.id (ej. admin anónimo del grupo) no hay forma segura de
    // aislar su espera de la de otra persona, así que ese flujo se ignora para este
    // mensaje — /caidos y su botón siguen funcionando igual, no dependen de from.id.
    const userId = update.message?.from?.id;
    const claveEspera = userId !== undefined ? `${chatId}:${userId}` : undefined;

    if (texto === TEXTO_BOTON_INGRESAR_CODIGO.toLowerCase()) {
      if (!claveEspera) {
        this.log.warn('Webhook de Telegram: botón "Ingresar código" sin remitente identificable — se ignora');
        return;
      }
      this.esperandoCodigo.set(claveEspera, Date.now());
      await this.telegram.enviarTexto(
        '✏️ Escriba el código del recinto que quiere consultar.',
        'el prompt de ingresar código',
      );
      return;
    }

    // El botón fijo del teclado manda su propio texto como un mensaje normal
    // (no como comando), así que hay que tratarlo igual que /caidos.
    const esComandoCaidos = texto.startsWith('/caidos') || texto === TEXTO_BOTON_CAIDOS.toLowerCase();
    if (esComandoCaidos) {
      if (claveEspera) this.esperandoCodigo.delete(claveEspera);
      await this.reenviarListaTelegram();
      return;
    }

    const esComandoAsignaciones =
      texto.startsWith('/asignaciones') || texto === TEXTO_BOTON_ASIGNACIONES.toLowerCase();
    if (esComandoAsignaciones) {
      if (claveEspera) this.esperandoCodigo.delete(claveEspera);
      try {
        await this.enviarAsignacionesTelegram();
      } catch (e) {
        this.log.error(`No se pudieron armar las asignaciones para Telegram: ${(e as Error)?.message ?? e}`);
        await this.telegram.enviarTexto(
          e instanceof DistributivoNoConfigurado
            ? '⚠️ El distributivo de técnicos todavía no está configurado en el servidor.'
            : '⚠️ No se pudieron consultar las asignaciones en este momento. Intente de nuevo en unos minutos.',
          'el aviso de error de asignaciones',
        );
      }
      return;
    }

    const esComandoEstadisticas =
      texto.startsWith('/estadisticas') || texto === TEXTO_BOTON_ESTADISTICAS.toLowerCase();
    if (esComandoEstadisticas) {
      if (claveEspera) this.esperandoCodigo.delete(claveEspera);
      try {
        await this.estadisticas.enviarEstadisticasTelegram();
      } catch (e) {
        this.log.error(`No se pudieron calcular las estadísticas para Telegram: ${(e as Error)?.message ?? e}`);
        await this.telegram.enviarTexto(
          '⚠️ No se pudieron calcular las estadísticas en este momento. Intente de nuevo en unos minutos.',
          'el aviso de error de estadísticas',
        );
      }
      return;
    }

    if (claveEspera && this.tieneEsperaCodigoVigente(claveEspera)) {
      this.esperandoCodigo.delete(claveEspera);
      await this.responderCodigoRecinto(textoOriginal);
    }
  }

  /** Botones Hoy/Semana/Mes de la tarjeta de estadísticas: cambian el mismo
   * mensaje al período tocado. Solo en el chat configurado y con un
   * callback_data conocido; cualquier otra cosa se ignora. */
  private async procesarBotonTelegram(boton: NonNullable<TelegramUpdate['callback_query']>): Promise<void> {
    const chatConfigurado = process.env.TELEGRAM_CHAT_ID;
    const chatId = boton.message?.chat?.id;
    if (!chatConfigurado || chatId === undefined || String(chatId) !== chatConfigurado) {
      this.log.warn(`Webhook de Telegram: botón desde un chat no autorizado (${chatId}) — se ignora`);
      return;
    }
    // Primero se contesta el toque (aunque luego se ignore), para que el botón no
    // quede "cargando" en el cliente de quien lo tocó.
    await this.telegram.responderBoton(boton.id);
    const periodo = CALLBACK_PERIODO.exec(boton.data ?? '')?.[1] as PeriodoEstadisticasEnlaces | undefined;
    const messageId = boton.message?.message_id;
    if (!periodo || typeof messageId !== 'number') return;
    if (this.toqueDemasiadoSeguido(messageId)) return;
    try {
      await this.estadisticas.mostrarPeriodoTelegram(periodo, messageId);
    } catch (e) {
      this.log.error(`No se pudieron calcular las estadísticas para Telegram: ${(e as Error)?.message ?? e}`);
      await this.telegram.enviarTexto(
        '⚠️ No se pudieron calcular las estadísticas en este momento. Intente de nuevo en unos minutos.',
        'el aviso de error de estadísticas',
      );
    }
  }

  /** true si ese mensaje se tocó hace menos de PAUSA_ENTRE_TOQUES_MS (y si no, lo registra). */
  private toqueDemasiadoSeguido(messageId: number, ahora = Date.now()): boolean {
    const anterior = this.ultimoToque.get(messageId);
    if (anterior !== undefined && ahora - anterior < PAUSA_ENTRE_TOQUES_MS) return true;
    // Solo importan los toques recientes: el mapa no crece sin límite.
    for (const [id, t] of this.ultimoToque) if (ahora - t >= PAUSA_ENTRE_TOQUES_MS) this.ultimoToque.delete(id);
    this.ultimoToque.set(messageId, ahora);
    return false;
  }

  /** true si la persona tocó "Ingresar código" hace menos de ESPERA_CODIGO_TTL_MS.
   * Una espera vieja (tocó el botón y nunca volvió a escribir) se descarta en vez
   * de reactivarse con un mensaje cualquiera que llegue mucho después. */
  private tieneEsperaCodigoVigente(clave: string): boolean {
    const marcadoEn = this.esperandoCodigo.get(clave);
    if (marcadoEn === undefined) return false;
    if (Date.now() - marcadoEn > EnlacesService.ESPERA_CODIGO_TTL_MS) {
      this.esperandoCodigo.delete(clave);
      return false;
    }
    return true;
  }

  /** Purga entradas vencidas de gente que tocó "Ingresar código" y nunca volvió a
   * escribir — sin esto, alguien con el secreto del webhook podría simular toques
   * del botón con from.id distintos en cada request y hacer crecer el mapa sin
   * límite. Se corre en el mismo cron de 5 minutos que ya revisa los enlaces, para
   * no necesitar un timer aparte. */
  private limpiarEsperasCodigoVencidas(): void {
    const ahora = Date.now();
    for (const [clave, marcadoEn] of this.esperandoCodigo) {
      if (ahora - marcadoEn > EnlacesService.ESPERA_CODIGO_TTL_MS) {
        this.esperandoCodigo.delete(clave);
      }
    }
  }

  /** Busca un recinto por código (solo Imbabura, que es lo único que este bot
   * sincroniza) y responde con código, nombre y estado — o avisa si no existe,
   * en vez de quedarse callado, para que la persona sepa que el código no se
   * reconoce y no piense que el bot no le respondió. */
  private async responderCodigoRecinto(codigo: string): Promise<void> {
    const recinto = await this.prisma.enlaceRecinto.findUnique({
      where: { codigoRecinto: codigo },
      select: { codigoRecinto: true, nombreRecinto: true, canton: true, estado: true },
    });
    if (!recinto) {
      await this.telegram.enviarTexto(
        `⚠️ No se encontró el recinto con código "${codigo}". Verifique el código e intente de nuevo.`,
        'el resultado de búsqueda de recinto (no encontrado)',
      );
      return;
    }

    const emojiEstado = recinto.estado === 'FALLO' ? '🔴' : '✅';
    const abreviatura = abreviarCanton(recinto.canton);
    const sufijoCanton = abreviatura ? ` (${abreviatura})` : '';
    await this.telegram.enviarTexto(
      `📍 ${recinto.codigoRecinto}${sufijoCanton} — ${recinto.nombreRecinto}\nEstado: ${emojiEstado} ${recinto.estado}`,
      'el resultado de búsqueda de recinto',
    );
  }

  async removeCorreo(correo: string): Promise<ConfigEnlacesResponse> {
    const normalizado = correo.trim().toLowerCase();
    const actual = await this.getConfig();
    const correos = actual.correos.filter((c) => c !== normalizado);
    return this.guardarCorreos(correos);
  }

  private async guardarCorreos(correos: string[]): Promise<ConfigEnlacesResponse> {
    const saved = await this.prisma.configEnlaces.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, correos },
      update: { correos },
    });
    return { correos: saved.correos };
  }
}
