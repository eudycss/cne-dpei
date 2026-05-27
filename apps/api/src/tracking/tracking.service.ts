import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  LlegadaRecintoRequest,
  LlegadaRecintoResponse,
  MiAsignacionResponse,
  RecepcionKitRequest,
  RecepcionKitResponse,
  SalidaDpiRequest,
  SalidaDpiResponse,
  ValidarKitResponse,
} from '@cne/shared-types';
import {
  llegadaRecintoSchema,
  recepcionKitSchema,
  salidaDpiSchema,
} from '@cne/shared-validation';

import { PrismaService } from '../db/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * HU2-CA1 / HU3-CA1: detalle del recinto, militar referencial y kits del
   * operador, con el estado de salida/llegada y qué kits han sido recibidos.
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

    const [salidaPrevia, llegadaPrevia, recepciones] = await this.prisma.$transaction([
      this.prisma.eventoTracking.findFirst({
        where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_DPI' },
        select: { id: true },
      }),
      this.prisma.eventoTracking.findFirst({
        where: { eventoId: evento.id, operadorId, tipo: 'LLEGADA_RECINTO' },
        select: { id: true },
      }),
      this.prisma.recepcionKit.findMany({
        where: { operadorId, kitId: { in: kits.map((k) => k.id) } },
        select: { kitId: true, fotoMilitarUrl: true },
      }),
    ]);

    const recibidosSet = new Set(recepciones.map((r) => r.kitId));
    const fotoMilitarUrl = recepciones.find((r) => r.fotoMilitarUrl)?.fotoMilitarUrl ?? null;

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
            id: militar.id,
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
        recibido: recibidosSet.has(k.id),
      })),
      yaRegistroSalida: !!salidaPrevia,
      yaRegistroLlegada: !!llegadaPrevia,
      fotoMilitarUrl,
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

    const kit = await this.prisma.kitElectoral.findFirst({
      where: { eventoId: evento.id, operadorId },
      select: { recintoId: true },
    });
    const recintoId = kit?.recintoId ?? null;

    const ocurridoEn = new Date(parsed.ocurridoEn);

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

  /**
   * HU3-CA2: almacena la foto del militar cifrada y devuelve el identificador
   * para usar en el subsiguiente POST /tracking/recepcion-kit.
   */
  async guardarFotoMilitar(file: Express.Multer.File): Promise<{ fotoUrl: string }> {
    if (!file) {
      throw new BadRequestException('Archivo de foto requerido');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('El archivo debe ser una imagen');
    }
    const fotoUrl = await this.storage.saveEncrypted({
      categoria: 'militares',
      buffer: file.buffer,
    });
    return { fotoUrl };
  }

  /**
   * HU3-CA5: valida que el código (escaneado o ingresado manualmente)
   * corresponda a un kit asignado al operador autenticado en el evento activo.
   */
  async validarKit(operadorId: string, codigo: string): Promise<ValidarKitResponse> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const kit = await this.prisma.kitElectoral.findUnique({
      where: { eventoId_codigoUnico: { eventoId: evento.id, codigoUnico: codigo.trim() } },
    });
    if (!kit) {
      throw new NotFoundException('Kit no encontrado en el evento activo');
    }
    if (kit.operadorId !== operadorId) {
      // HU3-CA5: bloquear si no le pertenece
      throw new BadRequestException('Este kit no te pertenece');
    }

    const yaRecibido = !!(await this.prisma.recepcionKit.findFirst({
      where: { kitId: kit.id, operadorId },
      select: { id: true },
    }));

    return {
      id: kit.id,
      codigoUnico: kit.codigoUnico,
      nombre: kit.nombre,
      contenidos: kit.contenidos ?? null,
      yaRecibido,
    };
  }

  /**
   * HU3-CA6: confirma la recepción de un kit específico tras escaneo o ingreso
   * manual. Inserta RecepcionKit con foto militar y ubicación; marca el kit
   * como ENTREGADO. Idempotente: si ya fue recibido, retorna el registro.
   */
  async confirmarRecepcionKit(
    operadorId: string,
    input: RecepcionKitRequest,
  ): Promise<RecepcionKitResponse> {
    const parsed = recepcionKitSchema.parse(input);

    const kit = await this.prisma.kitElectoral.findUnique({ where: { id: parsed.kitId } });
    if (!kit) throw new NotFoundException('Kit no encontrado');
    if (kit.operadorId !== operadorId) {
      throw new BadRequestException('Este kit no te pertenece');
    }

    const fotoExiste = await this.storage.exists(parsed.fotoMilitarUrl);
    if (!fotoExiste) {
      throw new BadRequestException('Foto del militar no encontrada. Vuelve a tomarla.');
    }

    const existente = await this.prisma.recepcionKit.findFirst({
      where: { kitId: kit.id, operadorId },
      select: { id: true, confirmadoEn: true },
    });
    if (existente) {
      return {
        id: existente.id,
        kitId: kit.id,
        confirmadoEn: existente.confirmadoEn.toISOString(),
      };
    }

    const inserted = await this.prisma.$queryRaw<{ id: string; confirmado_en: Date }[]>`
      INSERT INTO recepciones_kit (id, kit_id, operador_id, militar_id, foto_militar_url, ubicacion, confirmado_en, desde_offline)
      VALUES (
        uuid_generate_v4(),
        ${kit.id}::uuid,
        ${operadorId}::uuid,
        ${parsed.militarId ?? null}::uuid,
        ${parsed.fotoMilitarUrl},
        ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography,
        now(),
        false
      )
      RETURNING id, confirmado_en;
    `;
    const row = inserted[0];

    await this.prisma.kitElectoral.update({
      where: { id: kit.id },
      data: { estado: 'ENTREGADO' },
    });

    return {
      id: row.id,
      kitId: kit.id,
      confirmadoEn: row.confirmado_en.toISOString(),
    };
  }

  /**
   * HU3-CA7: registra EventoTracking LLEGADA_RECINTO con GPS, valida que se
   * hayan recibido todos los kits y notifica a supervisor y administradores.
   * Rechaza segundo POST con 409.
   */
  async registrarLlegadaRecinto(
    operadorId: string,
    input: LlegadaRecintoRequest,
  ): Promise<LlegadaRecintoResponse> {
    const parsed = llegadaRecintoSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const existente = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'LLEGADA_RECINTO' },
      select: { id: true },
    });
    if (existente) throw new ConflictException('Ya registraste tu llegada al recinto');

    const salidaPrevia = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_DPI' },
      select: { id: true },
    });
    if (!salidaPrevia) {
      throw new BadRequestException('Debes registrar la salida del DPI antes de la llegada al recinto');
    }

    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId: evento.id, operadorId },
      select: { id: true, recintoId: true },
    });
    const recepciones = await this.prisma.recepcionKit.findMany({
      where: { operadorId, kitId: { in: kits.map((k) => k.id) } },
      select: { kitId: true },
    });
    const recibidos = new Set(recepciones.map((r) => r.kitId));
    const pendientes = kits.filter((k) => !recibidos.has(k.id));
    if (pendientes.length > 0) {
      throw new BadRequestException(
        `Faltan ${pendientes.length} kit(s) por confirmar antes de registrar la llegada`,
      );
    }

    const recintoId = kits[0]?.recintoId ?? null;
    const ocurridoEn = new Date(parsed.ocurridoEn);

    const id: string = (await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO eventos_tracking (id, evento_id, operador_id, tipo, recinto_id, ubicacion, ocurrido_en, desde_offline, registrado_en)
      VALUES (
        uuid_generate_v4(),
        ${evento.id}::uuid,
        ${operadorId}::uuid,
        'LLEGADA_RECINTO'::tipo_tracking,
        ${recintoId}::uuid,
        ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography,
        ${ocurridoEn}::timestamptz,
        false,
        now()
      )
      RETURNING id;
    `)[0].id;

    if (recintoId) {
      await this.prisma.kitElectoral.updateMany({
        where: { eventoId: evento.id, operadorId, estado: 'ENTREGADO' },
        data: { estado: 'EN_RECINTO' },
      });
    }

    const operador = await this.prisma.usuario.findUnique({
      where: { id: operadorId },
      select: { nombres: true, apellidos: true },
    });
    const recintoNombre = recintoId
      ? (await this.prisma.recinto.findUnique({ where: { id: recintoId }, select: { nombre: true } }))?.nombre ?? null
      : null;

    await this.notifications.encolarLlegadaRecinto({
      operadorId,
      eventoId: evento.id,
      payload: {
        operadorId,
        operadorNombre: operador ? `${operador.nombres} ${operador.apellidos}` : null,
        recintoNombre,
        kitsRecibidos: kits.length,
        ocurridoEn: ocurridoEn.toISOString(),
      },
    });

    return { id, ocurridoEn: ocurridoEn.toISOString() };
  }
}
