import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ConfigEnlacesResponse, EnlaceRecinto } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { resolveNotifier, type EnlaceCaido } from '../auth/notifier';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import { TelegramNotifier } from './telegram-notifier';
import { NotificationsService } from '../notifications/notifications.service';

const CONFIG_ID = 1;

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

    for (const fila of filas) {
      const anterior = await this.prisma.enlaceRecinto.findUnique({
        where: { codigoRecinto: fila.codigoRecinto },
      });

      await this.prisma.enlaceRecinto.upsert({
        where: { codigoRecinto: fila.codigoRecinto },
        create: {
          codigoRecinto: fila.codigoRecinto,
          nombreRecinto: fila.nombreRecinto,
          estado: fila.estado,
          estadoAnterior: null,
        },
        update: {
          nombreRecinto: fila.nombreRecinto,
          estado: fila.estado,
          estadoAnterior: anterior?.estado ?? null,
        },
      });

      const cayoAhora = anterior?.estado === 'ACTIVO' && fila.estado === 'FALLO';
      if (cayoAhora) {
        caidas.push({ codigoRecinto: fila.codigoRecinto, nombreRecinto: fila.nombreRecinto });
        await this.notificarCaida(fila.codigoRecinto, fila.nombreRecinto);
      }
    }

    await this.notificarCaidasPorCorreo(caidas);
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

  private async notificarCaida(codigoRecinto: string, nombreRecinto: string): Promise<void> {
    try {
      await this.telegram.enviarEnlaceCaido(codigoRecinto, nombreRecinto);
    } catch (e) {
      this.log.error(`Error enviando Telegram de enlace caído (${codigoRecinto}): ${e}`);
    }

    try {
      await this.notifications.encolarEnlaceCaido({ codigoRecinto, nombreRecinto });
    } catch (e) {
      this.log.error(`Error encolando aviso in-app de enlace caído (${codigoRecinto}): ${e}`);
    }
  }

  async list(): Promise<EnlaceRecinto[]> {
    const rows = await this.prisma.enlaceRecinto.findMany({ orderBy: { codigoRecinto: 'asc' } });
    return rows.map((r: any) => ({
      codigoRecinto: r.codigoRecinto,
      nombreRecinto: r.nombreRecinto,
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
    const correos = actual.correos.includes(normalizado) ? actual.correos : [...actual.correos, normalizado];
    return this.guardarCorreos(correos);
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
