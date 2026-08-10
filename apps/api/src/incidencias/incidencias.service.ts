import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateIncidenciaRequest,
  Incidencia,
  IncidenciaComentario,
  IncidenciaDetalle,
  Paginated,
  RoleName,
  UpdateEstadoIncidenciaRequest,
} from '@cne/shared-types';
import {
  createIncidenciaSchema,
  updateEstadoIncidenciaSchema,
} from '@cne/shared-validation';

import { PrismaService } from '../db/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class IncidenciasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * HU14-CA1: registra una incidencia reportada por el operador.
   * El eventoId y operadorId se derivan del usuario autenticado.
   * Si viene fotoBase64, la guarda cifrada y almacena el identificador.
   * Notifica al supervisor y administradores del operador.
   */
  async create(operadorId: string, input: CreateIncidenciaRequest): Promise<Incidencia> {
    const parsed = createIncidenciaSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) {
      throw new NotFoundException('No hay un evento electoral activo');
    }

    // Validar recintoId si viene
    if (parsed.recintoId) {
      const recinto = await this.prisma.recinto.findUnique({
        where: { id: parsed.recintoId },
        select: { id: true },
      });
      if (!recinto) throw new BadRequestException('Recinto no encontrado');
    }

    // Validar kitId si viene
    if (parsed.kitId) {
      const kit = await this.prisma.kitElectoral.findUnique({
        where: { id: parsed.kitId },
        select: { id: true },
      });
      if (!kit) throw new BadRequestException('Kit no encontrado');
    }

    // Procesar foto base64 opcional
    let fotoUrl: string | null = null;
    if (parsed.fotoBase64) {
      // Quitar el prefijo data:image/...;base64, si viene
      const base64Data = parsed.fotoBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0) {
        throw new BadRequestException('Foto inválida');
      }
      fotoUrl = await this.storage.saveEncrypted({
        categoria: 'incidencias',
        buffer,
        maxBytes: 8 * 1024 * 1024,
      });
    }

    // Insertar con $queryRaw para manejar el campo geography
    let incidenciaId: string;
    if (parsed.lat != null && parsed.lng != null) {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO incidencias (
          id, evento_id, operador_id, recinto_id, kit_id,
          tipo, descripcion, foto_url, ubicacion, estado,
          reportado_en, desde_offline
        ) VALUES (
          uuid_generate_v4(),
          ${evento.id}::uuid,
          ${operadorId}::uuid,
          ${parsed.recintoId ?? null}::uuid,
          ${parsed.kitId ?? null}::uuid,
          ${parsed.tipo}::tipo_incidencia,
          ${parsed.descripcion ?? null},
          ${fotoUrl},
          ST_SetSRID(ST_MakePoint(${parsed.lng}, ${parsed.lat}), 4326)::geography,
          'ABIERTA'::estado_incidencia,
          now(),
          ${parsed.desdeOffline ?? false}
        )
        RETURNING id;
      `;
      incidenciaId = rows[0].id;
    } else {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO incidencias (
          id, evento_id, operador_id, recinto_id, kit_id,
          tipo, descripcion, foto_url, ubicacion, estado,
          reportado_en, desde_offline
        ) VALUES (
          uuid_generate_v4(),
          ${evento.id}::uuid,
          ${operadorId}::uuid,
          ${parsed.recintoId ?? null}::uuid,
          ${parsed.kitId ?? null}::uuid,
          ${parsed.tipo}::tipo_incidencia,
          ${parsed.descripcion ?? null},
          ${fotoUrl},
          NULL,
          'ABIERTA'::estado_incidencia,
          now(),
          ${parsed.desdeOffline ?? false}
        )
        RETURNING id;
      `;
      incidenciaId = rows[0].id;
    }

    const operador = await this.prisma.usuario.findUnique({
      where: { id: operadorId },
      select: { nombres: true, apellidos: true },
    });

    await this.notifications.encolarIncidencia({
      operadorId,
      eventoId: evento.id,
      payload: {
        incidenciaId,
        operadorId,
        operadorNombre: operador ? `${operador.nombres} ${operador.apellidos}` : null,
        tipo: parsed.tipo,
        descripcion: parsed.descripcion ?? null,
      },
    });

    const incidencia = await this.findOneRaw(incidenciaId);
    if (!incidencia) throw new NotFoundException('Incidencia no encontrada tras creación');
    return incidencia;
  }

  /**
   * HU14-CA2: lista incidencias paginadas con filtros opcionales.
   * Supervisores solo ven incidencias de sus operadores asignados.
   */
  async list(opts: {
    viewerId: string;
    roles: RoleName[];
    estado?: string;
    eventoId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Paginated<Incidencia>> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

    const where: any = {};
    if (opts.estado) where.estado = opts.estado;
    if (opts.eventoId) where.eventoId = opts.eventoId;

    const esAdmin = opts.roles.includes('ADMINISTRADOR');
    if (!esAdmin) {
      // Supervisor: solo ve incidencias de sus operadores asignados en todos los eventos
      const asignaciones = await this.prisma.asignacionSupervisor.findMany({
        where: { supervisorId: opts.viewerId },
        select: { operadorId: true },
      });
      const operadorIds = asignaciones.map((a) => a.operadorId);
      if (operadorIds.length === 0) {
        return { items: [], total: 0, page, pageSize };
      }
      where.operadorId = { in: operadorIds };
    }

    return this.paginarConWhere(where, page, pageSize);
  }

  /**
   * HU14: lista las incidencias reportadas por el propio operador autenticado.
   */
  async listMias(opts: {
    operadorId: string;
    estado?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Paginated<Incidencia>> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

    const where: any = { operadorId: opts.operadorId };
    if (opts.estado) where.estado = opts.estado;

    return this.paginarConWhere(where, page, pageSize);
  }

  private async paginarConWhere(
    where: any,
    page: number,
    pageSize: number,
  ): Promise<Paginated<Incidencia>> {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.incidencia.count({ where }),
      this.prisma.incidencia.findMany({
        where,
        orderBy: { reportadoEn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          eventoId: true,
          operadorId: true,
          recintoId: true,
          kitId: true,
          tipo: true,
          descripcion: true,
          fotoUrl: true,
          estado: true,
          reportadoEn: true,
          desdeOffline: true,
        },
      }),
    ]);

    // Enriquecer con nombres (operador, recinto, kit)
    const operadorIds = Array.from(new Set(rows.map((r) => r.operadorId)));
    const recintoIds = Array.from(new Set(rows.map((r) => r.recintoId).filter(Boolean) as string[]));
    const kitIds = Array.from(new Set(rows.map((r) => r.kitId).filter(Boolean) as string[]));

    const [operadores, recintos, kits] = await Promise.all([
      this.prisma.usuario.findMany({
        where: { id: { in: operadorIds } },
        select: { id: true, nombres: true, apellidos: true },
      }),
      recintoIds.length > 0
        ? this.prisma.recinto.findMany({
            where: { id: { in: recintoIds } },
            select: { id: true, nombre: true },
          })
        : ([] as { id: string; nombre: string }[]),
      kitIds.length > 0
        ? this.prisma.kitElectoral.findMany({
            where: { id: { in: kitIds } },
            select: { id: true, codigoUnico: true },
          })
        : ([] as { id: string; codigoUnico: string }[]),
    ]);

    const operadorMap = new Map<string, string>(operadores.map((o) => [o.id, `${o.nombres} ${o.apellidos}`]));
    const recintoMap = new Map<string, string>(recintos.map((r) => [r.id, r.nombre]));
    const kitMap = new Map<string, string>(kits.map((k) => [k.id, k.codigoUnico]));

    // Leer ubicaciones con $queryRaw para los registros que las tienen
    const idsConUbicacion = rows.map((r) => r.id);
    const ubicaciones = idsConUbicacion.length > 0
      ? await this.prisma.$queryRaw<{ id: string; lat: number; lng: number }[]>`
          SELECT id,
                 ST_Y(ubicacion::geometry) AS lat,
                 ST_X(ubicacion::geometry) AS lng
          FROM incidencias
          WHERE id = ANY(${idsConUbicacion}::uuid[])
            AND ubicacion IS NOT NULL;
        `
      : [];
    const ubicacionMap = new Map(
      ubicaciones.map((u): [string, { id: string; lat: number; lng: number }] => [u.id, u]),
    );

    return {
      items: rows.map((r) => toIncidenciaDto(r, operadorMap, recintoMap, kitMap, ubicacionMap)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * HU14-CA3: detalle de una incidencia con sus comentarios.
   */
  async findOne(id: string, viewerId: string, roles: RoleName[]): Promise<IncidenciaDetalle> {
    await this.checkAccess(id, viewerId, roles);

    const incidencia = await this.findOneRaw(id);
    if (!incidencia) throw new NotFoundException('Incidencia no encontrada');

    const comentariosRaw = await this.prisma.incidenciaComentario.findMany({
      where: { incidenciaId: id },
      orderBy: { creadoEn: 'asc' },
      select: {
        id: true,
        incidenciaId: true,
        usuarioId: true,
        comentario: true,
        creadoEn: true,
      },
    });

    const usuarioIds = Array.from(new Set(comentariosRaw.map((c) => c.usuarioId)));
    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: usuarioIds } },
      select: { id: true, nombres: true, apellidos: true },
    });
    const usuarioMap = new Map<string, string>(
      usuarios.map((u): [string, string] => [u.id, `${u.nombres} ${u.apellidos}`]),
    );

    return {
      ...incidencia,
      comentarios: comentariosRaw.map((c) => toComentarioDto(c, usuarioMap)),
    };
  }

  /**
   * HU14-CA4: cambia el estado de una incidencia a ATENDIDA o CERRADA.
   * Si viene comentario, crea un IncidenciaComentario con el usuario autenticado.
   */
  async updateEstado(
    id: string,
    viewerId: string,
    roles: RoleName[],
    input: UpdateEstadoIncidenciaRequest,
  ): Promise<Incidencia> {
    const parsed = updateEstadoIncidenciaSchema.parse(input);
    await this.checkAccess(id, viewerId, roles);

    const incidencia = await this.prisma.incidencia.findUnique({
      where: { id },
      select: { id: true, estado: true },
    });
    if (!incidencia) throw new NotFoundException('Incidencia no encontrada');
    if (incidencia.estado === 'CERRADA') {
      throw new BadRequestException('La incidencia ya está cerrada y no puede modificarse');
    }

    await this.prisma.incidencia.update({
      where: { id },
      data: { estado: parsed.estado },
    });

    if (parsed.comentario) {
      await this.prisma.incidenciaComentario.create({
        data: {
          incidenciaId: id,
          usuarioId: viewerId,
          comentario: parsed.comentario,
        },
      });
    }

    const updated = await this.findOneRaw(id);
    if (!updated) throw new NotFoundException('Incidencia no encontrada tras actualización');
    return updated;
  }

  /**
   * HU14: foto adjunta a la incidencia, descifrada (mismo patrón que
   * TrackingService.obtenerFotoMilitar).
   */
  async obtenerFoto(
    id: string,
    viewerId: string,
    roles: RoleName[],
  ): Promise<{ buffer: Buffer; contentType: string }> {
    await this.checkAccess(id, viewerId, roles);

    const incidencia = await this.prisma.incidencia.findUnique({
      where: { id },
      select: { fotoUrl: true },
    });
    if (!incidencia?.fotoUrl) {
      throw new NotFoundException('La incidencia no tiene foto adjunta');
    }

    const buffer = await this.storage.readDecrypted(incidencia.fotoUrl);
    return { buffer, contentType: detectarContentTypeImagen(buffer) };
  }

  /**
   * HU14-CA5: lista los comentarios de una incidencia.
   */
  async listComentarios(
    id: string,
    viewerId: string,
    roles: RoleName[],
  ): Promise<IncidenciaComentario[]> {
    await this.checkAccess(id, viewerId, roles);

    const comentariosRaw = await this.prisma.incidenciaComentario.findMany({
      where: { incidenciaId: id },
      orderBy: { creadoEn: 'asc' },
      select: {
        id: true,
        incidenciaId: true,
        usuarioId: true,
        comentario: true,
        creadoEn: true,
      },
    });

    const usuarioIds = Array.from(new Set(comentariosRaw.map((c) => c.usuarioId)));
    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: usuarioIds } },
      select: { id: true, nombres: true, apellidos: true },
    });
    const usuarioMap = new Map<string, string>(
      usuarios.map((u): [string, string] => [u.id, `${u.nombres} ${u.apellidos}`]),
    );

    return comentariosRaw.map((c) => toComentarioDto(c, usuarioMap));
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  private async findOneRaw(id: string): Promise<Incidencia | null> {
    const rows = await this.prisma.incidencia.findMany({
      where: { id },
      select: {
        id: true,
        eventoId: true,
        operadorId: true,
        recintoId: true,
        kitId: true,
        tipo: true,
        descripcion: true,
        fotoUrl: true,
        estado: true,
        reportadoEn: true,
        desdeOffline: true,
      },
    });
    if (rows.length === 0) return null;
    const row = rows[0];

    const [operador, recinto, kit, ubicRaw] = await Promise.all([
      this.prisma.usuario.findUnique({
        where: { id: row.operadorId },
        select: { nombres: true, apellidos: true },
      }),
      row.recintoId
        ? this.prisma.recinto.findUnique({ where: { id: row.recintoId }, select: { nombre: true } })
        : null,
      row.kitId
        ? this.prisma.kitElectoral.findUnique({ where: { id: row.kitId }, select: { codigoUnico: true } })
        : null,
      this.prisma.$queryRaw<{ lat: number; lng: number }[]>`
        SELECT ST_Y(ubicacion::geometry) AS lat,
               ST_X(ubicacion::geometry) AS lng
        FROM incidencias
        WHERE id = ${id}::uuid AND ubicacion IS NOT NULL;
      `,
    ]);

    const pos = ubicRaw.length > 0 ? ubicRaw[0] : null;

    return {
      id: row.id,
      eventoId: row.eventoId,
      operadorId: row.operadorId,
      operadorNombre: operador ? `${operador.nombres} ${operador.apellidos}` : null,
      recintoId: row.recintoId,
      recintoNombre: recinto?.nombre ?? null,
      kitId: row.kitId,
      kitCodigo: kit?.codigoUnico ?? null,
      tipo: row.tipo as any,
      descripcion: row.descripcion,
      fotoUrl: row.fotoUrl,
      latitud: pos?.lat ?? null,
      longitud: pos?.lng ?? null,
      estado: row.estado as any,
      reportadoEn: row.reportadoEn.toISOString(),
      desdeOffline: row.desdeOffline,
    };
  }

  /** Verifica que el viewer tenga acceso a la incidencia. */
  private async checkAccess(id: string, viewerId: string, roles: RoleName[]): Promise<void> {
    const esAdmin = roles.includes('ADMINISTRADOR');
    if (esAdmin) return;

    const incidencia = await this.prisma.incidencia.findUnique({
      where: { id },
      select: { operadorId: true },
    });
    if (!incidencia) throw new NotFoundException('Incidencia no encontrada');

    const asignado = await this.prisma.asignacionSupervisor.findFirst({
      where: { supervisorId: viewerId, operadorId: incidencia.operadorId },
      select: { id: true },
    });
    if (!asignado) throw new NotFoundException('Incidencia no encontrada');
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toIncidenciaDto(
  row: any,
  operadorMap: Map<string, string>,
  recintoMap: Map<string, string>,
  kitMap: Map<string, string>,
  ubicacionMap: Map<string, { lat: number; lng: number }>,
): Incidencia {
  const pos = ubicacionMap.get(row.id);
  return {
    id: row.id,
    eventoId: row.eventoId,
    operadorId: row.operadorId,
    operadorNombre: operadorMap.get(row.operadorId) ?? null,
    recintoId: row.recintoId ?? null,
    recintoNombre: row.recintoId ? (recintoMap.get(row.recintoId) ?? null) : null,
    kitId: row.kitId ?? null,
    kitCodigo: row.kitId ? (kitMap.get(row.kitId) ?? null) : null,
    tipo: row.tipo,
    descripcion: row.descripcion ?? null,
    fotoUrl: row.fotoUrl ?? null,
    latitud: pos?.lat ?? null,
    longitud: pos?.lng ?? null,
    estado: row.estado,
    reportadoEn: row.reportadoEn instanceof Date ? row.reportadoEn.toISOString() : row.reportadoEn,
    desdeOffline: row.desdeOffline,
  };
}

function toComentarioDto(
  row: any,
  usuarioMap: Map<string, string>,
): IncidenciaComentario {
  return {
    id: row.id,
    incidenciaId: row.incidenciaId,
    usuarioId: row.usuarioId,
    usuarioNombre: usuarioMap.get(row.usuarioId) ?? null,
    comentario: row.comentario,
    creadoEn: row.creadoEn instanceof Date ? row.creadoEn.toISOString() : row.creadoEn,
  };
}

/** Detecta el content-type de una imagen a partir de sus magic bytes. */
function detectarContentTypeImagen(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'GIF8') {
    return 'image/gif';
  }
  return 'image/jpeg';
}
