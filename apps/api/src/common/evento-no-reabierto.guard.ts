import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';

export const MENSAJE_EVENTO_REABIERTO =
  'El evento fue reabierto solo para consulta; no se pueden registrar acciones';

/**
 * Bloquea los registros de campo (tracking, custodia, incidencias) mientras el
 * evento activo sea uno cerrado que se reabrió solo para consulta.
 *
 * Responde 403 y no 409 a propósito: la cola offline del móvil
 * (apps/mobile/src/lib/offline-queue.ts) toma el 409 como "ya registrado" y
 * descartaría la acción sin avisar; con 403 queda en "rechazadas".
 */
@Injectable()
export class EventoNoReabiertoGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(): Promise<boolean> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { reabiertoEn: true },
    });
    if (evento?.reabiertoEn) throw new ForbiddenException(MENSAJE_EVENTO_REABIERTO);
    return true;
  }
}
