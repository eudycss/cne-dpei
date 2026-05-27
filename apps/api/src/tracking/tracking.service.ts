import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  MiAsignacionResponse,
  SalidaDpiRequest,
  SalidaDpiResponse,
} from '@cne/shared-types';
import { salidaDpiSchema } from '@cne/shared-validation';

import { PrismaService } from '../db/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * HU2-CA1: para el operador autenticado, devuelve el recinto asignado
   * (vía kits), el militar referencial del recinto y la lista de kits.
   */
  async miAsignacion(operadorId: string): Promise<MiAsignacionResponse> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
    });
    if (!evento) {
      throw new NotFoundException('No hay un evento electoral activo');
    }

    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId: evento.id, operadorId },
      orderBy: { codigoUnico: 'asc' },
    });
    if (kits.length === 0) {
      throw new NotFoundException(
        'No tienes kits asignados para el evento activo. Contacta a tu supervisor.',
      );
    }

    const recintoIds = Array.from(new Set(kits.map((k) => k.recintoId).filter(Boolean) as string[]));
    if (recintoIds.length === 0) {
      throw new NotFoundException('Tus kits no tienen recinto asignado todavía');
    }
    if (recintoIds.length > 1) {
      // Defensa: HU12-CA3 garantiza un único recinto por operador. Si llega aquí, hay inconsistencia.
      throw new ConflictException(
        'Tus kits están asignados a varios recintos. Contacta al administrador.',
      );
    }
    const recintoId = recintoIds[0];

    const recinto = await this.prisma.recinto.findUnique({
      where: { id: recintoId },
      include: { canton: true },
    });
    if (!recinto) throw new NotFoundException('Recinto no encontrado');

    const militar = await this.prisma.militar.findFirst({
      where: { recintoId },
      orderBy: { creadoEn: 'asc' },
    });

    const salidaPrevia = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_DPI' },
      select: { id: true },
    });

    return {
      eventoId: evento.id,
      eventoNombre: evento.nombre,
      recinto: {
        id: recinto.id,
        codigoRecinto: recinto.codigoRecinto,
        nombre: recinto.nombre,
        direccion: recinto.direccion ?? null,
        cantonNombre: recinto.canton?.nombre ?? null,
        parroquia: recinto.parroquia ?? null,
      },
      militar: militar
        ? {
            nombres: militar.nombres,
            apellidos: militar.apellidos,
            cedula: militar.cedula,
          }
        : null,
      kits: kits.map((k) => ({
        id: k.id,
        codigoUnico: k.codigoUnico,
        nombre: k.nombre,
        contenidos: k.contenidos ?? null,
      })),
      yaRegistroSalida: !!salidaPrevia,
    };
  }

  /**
   * HU2-CA2/CA3: registra un EventoTracking SALIDA_DPI con ubicación GPS puntual,
   * encola notificaciones para supervisor y administradores. Rechaza segundo POST.
   */
  async registrarSalidaDpi(
    operadorId: string,
    input: SalidaDpiRequest,
  ): Promise<SalidaDpiResponse> {
    const parsed = salidaDpiSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
    });
    if (!evento) {
      throw new NotFoundException('No hay un evento electoral activo');
    }

    const existente = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_DPI' },
      select: { id: true, ocurridoEn: true },
    });
    if (existente) {
      throw new ConflictException('Ya registraste tu salida del DPI');
    }

    // Resolver el recinto del operador (mismo lookup que miAsignacion, simplificado)
    const kit = await this.prisma.kitElectoral.findFirst({
      where: { eventoId: evento.id, operadorId },
      select: { recintoId: true },
    });
    const recintoId = kit?.recintoId ?? null;

    const ocurridoEn = new Date(parsed.ocurridoEn);

    // Insertar EventoTracking con ubicación GEOGRAPHY vía raw SQL
    // (campo `ubicacion` es Unsupported en Prisma).
    const id: string = (await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO eventos_tracking (id, evento_id, operador_id, tipo, recinto_id, ubicacion, ocurrido_en, desde_offline, registrado_en)
      VALUES (
        uuid_generate_v4(),
        ${evento.id}::uuid,
        ${operadorId}::uuid,
        'SALIDA_DPI'::tipo_tracking,
        ${recintoId}::uuid,
        ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography,
        ${ocurridoEn}::timestamptz,
        false,
        now()
      )
      RETURNING id;
    `)[0].id;

    const operador = await this.prisma.usuario.findUnique({
      where: { id: operadorId },
      select: { nombres: true, apellidos: true },
    });
    const recintoNombre = recintoId
      ? (await this.prisma.recinto.findUnique({ where: { id: recintoId }, select: { nombre: true } }))?.nombre ?? null
      : null;

    await this.notifications.encolarSalidaDpi({
      operadorId,
      eventoId: evento.id,
      payload: {
        operadorId,
        operadorNombre: operador ? `${operador.nombres} ${operador.apellidos}` : null,
        recintoNombre,
        ocurridoEn: ocurridoEn.toISOString(),
      },
    });

    return { id, ocurridoEn: ocurridoEn.toISOString() };
  }
}
