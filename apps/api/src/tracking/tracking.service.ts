import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  IngestaPosicionesRequest,
  IngestaPosicionesResponse,
  LlegadaRecintoRequest,
  LlegadaRecintoResponse,
  MiAsignacionResponse,
  OperadorEnRetorno,
  RecepcionKitRequest,
  RecepcionKitResponse,
  RoleName,
  SalidaDpiRequest,
  SalidaDpiResponse,
  SalidaRecintoRequest,
  SalidaRecintoResponse,
  ValidarKitResponse,
} from '@cne/shared-types';
import {
  ingestaPosicionesSchema,
  llegadaRecintoSchema,
  recepcionKitSchema,
  salidaDpiSchema,
  salidaRecintoSchema,
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

    const [salidaPrevia, llegadaPrevia, salidaRecintoPrevia, recepciones] =
      await this.prisma.$transaction([
        this.prisma.eventoTracking.findFirst({
          where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_DPI' },
          select: { id: true },
        }),
        this.prisma.eventoTracking.findFirst({
          where: { eventoId: evento.id, operadorId, tipo: 'LLEGADA_RECINTO' },
          select: { id: true },
        }),
        this.prisma.eventoTracking.findFirst({
          where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_RECINTO' },
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
      yaRegistroSalidaRecinto: !!salidaRecintoPrevia,
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

  /**
   * HU4-CA2/CA3: registra EventoTracking SALIDA_RECINTO con GPS, valida que la
   * llegada al recinto se haya registrado antes, marca los kits como EN_RETORNO
   * y notifica a supervisor y administradores. A partir de aquí el móvil arranca
   * el rastreo continuo. Rechaza segundo POST con 409.
   */
  async registrarSalidaRecinto(
    operadorId: string,
    input: SalidaRecintoRequest,
  ): Promise<SalidaRecintoResponse> {
    const parsed = salidaRecintoSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const existente = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_RECINTO' },
      select: { id: true },
    });
    if (existente) throw new ConflictException('Ya registraste tu salida del recinto');

    const llegadaPrevia = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'LLEGADA_RECINTO' },
      select: { id: true },
    });
    if (!llegadaPrevia) {
      throw new BadRequestException(
        'Debes registrar la llegada al recinto antes de la salida del recinto',
      );
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
        'SALIDA_RECINTO'::tipo_tracking,
        ${recintoId}::uuid,
        ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography,
        ${ocurridoEn}::timestamptz,
        false,
        now()
      )
      RETURNING id;
    `)[0].id;

    await this.prisma.kitElectoral.updateMany({
      where: { eventoId: evento.id, operadorId, estado: 'EN_RECINTO' },
      data: { estado: 'EN_RETORNO' },
    });

    const operador = await this.prisma.usuario.findUnique({
      where: { id: operadorId },
      select: { nombres: true, apellidos: true },
    });
    const recintoNombre = recintoId
      ? (await this.prisma.recinto.findUnique({ where: { id: recintoId }, select: { nombre: true } }))?.nombre ?? null
      : null;

    await this.notifications.encolarSalidaRecinto({
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
   * HU4-CA3: ingesta de un lote de posiciones GPS capturadas por el móvil durante
   * el tramo de retorno al DPI. Solo se aceptan puntos mientras el operador esté
   * en retorno (registró SALIDA_RECINTO y aún no LLEGADA_DPI).
   */
  async ingestarPosiciones(
    operadorId: string,
    input: IngestaPosicionesRequest,
  ): Promise<IngestaPosicionesResponse> {
    const parsed = ingestaPosicionesSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const [salidaRecinto, llegadaDpi] = await this.prisma.$transaction([
      this.prisma.eventoTracking.findFirst({
        where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_RECINTO' },
        select: { id: true },
      }),
      this.prisma.eventoTracking.findFirst({
        where: { eventoId: evento.id, operadorId, tipo: 'LLEGADA_DPI' },
        select: { id: true },
      }),
    ]);
    if (!salidaRecinto) {
      throw new BadRequestException('Aún no has registrado la salida del recinto');
    }
    if (llegadaDpi) {
      throw new BadRequestException('Ya registraste tu llegada al DPI; el rastreo finalizó');
    }

    for (const p of parsed.posiciones) {
      await this.prisma.$executeRaw`
        INSERT INTO posiciones_gps (operador_id, evento_id, ubicacion, capturado_en, recibido_en)
        VALUES (
          ${operadorId}::uuid,
          ${evento.id}::uuid,
          ST_SetSRID(ST_MakePoint(${p.longitud}, ${p.latitud}), 4326)::geography,
          ${new Date(p.capturadoEn)}::timestamptz,
          now()
        );
      `;
    }

    return { recibidas: parsed.posiciones.length };
  }

  /**
   * HU4-CA4 / HU6: operadores actualmente en su tramo de retorno (registraron
   * SALIDA_RECINTO y aún no LLEGADA_DPI) con su última posición GPS conocida.
   * Los supervisores solo ven a sus operadores asignados; los administradores
   * los ven a todos.
   */
  async operadoresEnRetorno(
    viewerId: string,
    roles: RoleName[],
  ): Promise<OperadorEnRetorno[]> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) return [];

    const esAdmin = roles.includes('ADMINISTRADOR');

    // Operadores con SALIDA_RECINTO y sin LLEGADA_DPI en el evento activo.
    const [salidas, llegadas] = await this.prisma.$transaction([
      this.prisma.eventoTracking.findMany({
        where: { eventoId: evento.id, tipo: 'SALIDA_RECINTO' },
        select: { operadorId: true },
      }),
      this.prisma.eventoTracking.findMany({
        where: { eventoId: evento.id, tipo: 'LLEGADA_DPI' },
        select: { operadorId: true },
      }),
    ]);
    const retornados = new Set(llegadas.map((l) => l.operadorId));
    let operadorIds = Array.from(new Set(salidas.map((s) => s.operadorId))).filter(
      (id) => !retornados.has(id),
    );

    if (!esAdmin) {
      const asignados = await this.prisma.asignacionSupervisor.findMany({
        where: { eventoId: evento.id, supervisorId: viewerId },
        select: { operadorId: true },
      });
      const permitidos = new Set(asignados.map((a) => a.operadorId));
      operadorIds = operadorIds.filter((id) => permitidos.has(id));
    }

    if (operadorIds.length === 0) return [];

    const operadores = await this.prisma.usuario.findMany({
      where: { id: { in: operadorIds } },
      select: { id: true, nombres: true, apellidos: true },
    });
    const nombrePorId = new Map(
      operadores.map((o) => [o.id, `${o.nombres} ${o.apellidos}`]),
    );

    const kitsPorOperador = await this.prisma.kitElectoral.groupBy({
      by: ['operadorId'],
      where: { eventoId: evento.id, operadorId: { in: operadorIds } },
      _count: { _all: true },
    });
    const kitsPorId = new Map(
      kitsPorOperador.map((k) => [k.operadorId as string, k._count._all]),
    );

    const resultado: OperadorEnRetorno[] = [];
    for (const id of operadorIds) {
      const ultima = await this.prisma.$queryRaw<
        { lat: number; lng: number; capturado_en: Date }[]
      >`
        SELECT ST_Y(ubicacion::geometry) AS lat,
               ST_X(ubicacion::geometry) AS lng,
               capturado_en
        FROM posiciones_gps
        WHERE operador_id = ${id}::uuid AND evento_id = ${evento.id}::uuid
        ORDER BY capturado_en DESC
        LIMIT 1;
      `;
      if (ultima.length === 0) continue; // sin posiciones todavía
      const pos = ultima[0];
      resultado.push({
        operadorId: id,
        operadorNombre: nombrePorId.get(id) ?? 'Operador',
        latitud: pos.lat,
        longitud: pos.lng,
        capturadoEn: pos.capturado_en.toISOString(),
        kits: kitsPorId.get(id) ?? 0,
      });
    }

    return resultado;
  }
}
