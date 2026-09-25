import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ConfigEnlacesResponse, EnlaceRecinto } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { resolveNotifier, type EnlaceCaido } from '../auth/notifier';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import { TelegramNotifier, TEXTO_BOTON_CAIDOS } from './telegram-notifier';
import { NotificationsService } from '../notifications/notifications.service';

const CONFIG_ID = 1;
const CANTON_MAX_LEN = 100;

/** Subconjunto mínimo del payload de un Telegram Update que necesita el webhook. */
export interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id: number | string };
  };
}

/** La hoja se edita a mano y puede traer mayúsculas inconsistentes (COTACACHI vs Cotacachi); se normaliza para que el filtro/dropdown de la web no los trate como cantones distintos. */
function normalizarCanton(valor: string | null | undefined): string | null {
  const limpio = (valor ?? '').trim();
  if (!limpio) return null;
  const tituloCase = limpio.toLowerCase().replace(/(^|\s)\p{L}/gu, (letra) => letra.toUpperCase());
  return tituloCase.slice(0, CANTON_MAX_LEN);
}

@Injectable()
export class EnlacesService {
  private readonly log = new Logger('EnlacesService');
  private readonly notifier = resolveNotifier();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetsClient: SheetsEnlacesClient,
    private readonly telegram: TelegramNotifier,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async revisarEnlaces(): Promise<void> {
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
          caidas.push({ codigoRecinto: fila.codigoRecinto, nombreRecinto: fila.nombreRecinto });
          await this.encolarAvisoInApp(fila.codigoRecinto, fila.nombreRecinto);
        }

        const seRecuperoAhora = fila.estado === 'ACTIVO' && anterior?.estado === 'FALLO';
        if (seRecuperoAhora) {
          recuperados.push({ codigoRecinto: fila.codigoRecinto, nombreRecinto: fila.nombreRecinto });
        }
      } catch (e) {
        // Un error puntual (ej. dato inválido de una sola fila) no debe tumbar
        // el resto del ciclo ni perder las notificaciones ya acumuladas.
        this.log.error(`Error procesando el recinto ${fila.codigoRecinto}: ${e}`);
      }
    }

    await this.notificarCaidasPorCorreo(caidas);
    await this.notificarCaidasPorTelegram(caidas, filas);
    await this.notificarRecuperadosPorCorreo(recuperados);
    await this.notificarRecuperadosPorTelegram(recuperados);
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

  private async notificarRecuperadosPorTelegram(recuperados: EnlaceCaido[]): Promise<void> {
    if (recuperados.length === 0) return;

    try {
      await this.telegram.enviarRecuperados(recuperados);
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
    filas: { codigoRecinto: string; nombreRecinto: string; estado: string }[],
  ): Promise<void> {
    if (nuevasCaidas.length === 0) return;

    try {
      const todasCaidas: EnlaceCaido[] = filas
        .filter((f) => f.estado === 'FALLO')
        .map((f) => ({ codigoRecinto: f.codigoRecinto, nombreRecinto: f.nombreRecinto }));
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
    }));
    await this.telegram.enviarListaActual(caidas);
    return { enviados: caidas.length };
  }

  /** Procesa un update entrante del webhook de Telegram: si es el comando
   * `/caidos` escrito en el grupo configurado, responde con la lista actual
   * de recintos caídos. Cualquier otra cosa (secreto inválido, chat distinto
   * al configurado, texto que no es el comando) se ignora en silencio — este
   * endpoint es público, así que nunca debe reaccionar a tráfico no confiable. */
  async procesarComandoTelegram(secretRecibido: string | undefined, update: TelegramUpdate): Promise<void> {
    const secretEsperado = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secretEsperado || secretRecibido !== secretEsperado) {
      this.log.warn('Webhook de Telegram: secreto ausente o inválido — se ignora el update');
      return;
    }

    const texto = update.message?.text?.trim().toLowerCase();
    const chatId = update.message?.chat?.id;
    // El botón fijo del teclado manda su propio texto como un mensaje normal
    // (no como comando), así que hay que tratarlo igual que /caidos.
    const esComandoCaidos = texto?.startsWith('/caidos') || texto === TEXTO_BOTON_CAIDOS.toLowerCase();
    if (!texto || chatId === undefined || !esComandoCaidos) return;

    const chatConfigurado = process.env.TELEGRAM_CHAT_ID;
    if (!chatConfigurado || String(chatId) !== chatConfigurado) {
      this.log.warn(`Webhook de Telegram: comando /caidos desde un chat no autorizado (${chatId}) — se ignora`);
      return;
    }

    await this.reenviarListaTelegram();
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
