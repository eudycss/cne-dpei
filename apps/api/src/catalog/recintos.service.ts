import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { createRecintoSchema, updateRecintoSchema } from '@cne/shared-validation';
import type {
  Canton,
  CreateRecintoRequest,
  Paginated,
  Recinto,
  UpdateRecintoRequest,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class RecintosService {
  constructor(private readonly prisma: PrismaService) {}

  async listRecintos(opts: {
    page?: number;
    pageSize?: number;
    search?: string;
    cantonId?: number;
    tipo?: 'CDA' | 'NO_CDA';
  }): Promise<Paginated<Recinto>> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
    const where: any = {};
    if (opts.search) {
      where.OR = [
        { nombre: { contains: opts.search, mode: 'insensitive' } },
        { codigoRecinto: { contains: opts.search } },
        { parroquia: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    if (opts.cantonId) where.cantonId = opts.cantonId;
    if (opts.tipo) where.tipo = opts.tipo;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.recinto.count({ where }),
      this.prisma.recinto.findMany({
        where,
        include: { canton: true },
        orderBy: { nombre: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const coords = await this.getCoords(items.map((i) => i.id));
    return {
      items: items.map((i) => toRecintoDto(i, coords.get(i.id))),
      total,
      page,
      pageSize,
    };
  }

  async getRecinto(id: string): Promise<Recinto> {
    const r = await this.prisma.recinto.findUnique({
      where: { id },
      include: { canton: true },
    });
    if (!r) throw new NotFoundException('Recinto no encontrado');
    const coords = await this.getCoords([id]);
    return toRecintoDto(r, coords.get(id));
  }

  async listCantones(): Promise<Canton[]> {
    const cantones = await this.prisma.canton.findMany({ orderBy: { nombre: 'asc' } });
    return cantones.map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre }));
  }

  async create(input: CreateRecintoRequest): Promise<Recinto> {
    const parsed = createRecintoSchema.parse(input);
    await this.assertCanton(parsed.cantonId);
    await this.assertCodigoDisponible(parsed.codigoRecinto);

    const id = crypto.randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO recintos (
        id, codigo_recinto, nombre, direccion, canton_id, parroquia, zona, tipo,
        ubicacion, tiene_internet, cobertura_movil, numero_electores,
        juntas_femeninas, juntas_masculinas
      ) VALUES (
        ${id}::uuid, ${parsed.codigoRecinto}, ${parsed.nombre}, ${parsed.direccion ?? null},
        ${parsed.cantonId}, ${parsed.parroquia ?? null}, ${parsed.zona ?? null}, ${parsed.tipo}::tipo_recinto,
        ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography,
        ${parsed.tieneInternet ?? false}, ${parsed.coberturaMovil ?? false}, ${parsed.numeroElectores ?? null},
        ${parsed.juntasFemeninas ?? null}, ${parsed.juntasMasculinas ?? null}
      )
    `;
    return this.getRecinto(id);
  }

  async update(id: string, input: UpdateRecintoRequest): Promise<Recinto> {
    const parsed = updateRecintoSchema.parse(input);
    const existing = await this.prisma.recinto.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Recinto no encontrado');

    if (parsed.cantonId) await this.assertCanton(parsed.cantonId);
    if (parsed.codigoRecinto && parsed.codigoRecinto !== existing.codigoRecinto) {
      await this.assertCodigoDisponible(parsed.codigoRecinto);
    }

    await this.prisma.recinto.update({
      where: { id },
      data: {
        codigoRecinto: parsed.codigoRecinto ?? undefined,
        nombre: parsed.nombre ?? undefined,
        direccion: parsed.direccion === undefined ? undefined : parsed.direccion,
        cantonId: parsed.cantonId ?? undefined,
        parroquia: parsed.parroquia === undefined ? undefined : parsed.parroquia,
        zona: parsed.zona === undefined ? undefined : parsed.zona,
        tipo: parsed.tipo ?? undefined,
        tieneInternet: parsed.tieneInternet ?? undefined,
        coberturaMovil: parsed.coberturaMovil ?? undefined,
        numeroElectores: parsed.numeroElectores === undefined ? undefined : parsed.numeroElectores,
        juntasFemeninas: parsed.juntasFemeninas === undefined ? undefined : parsed.juntasFemeninas,
        juntasMasculinas: parsed.juntasMasculinas === undefined ? undefined : parsed.juntasMasculinas,
      },
    });

    if (parsed.latitud !== undefined && parsed.longitud !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE recintos
        SET ubicacion = ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography
        WHERE id = ${id}::uuid
      `;
    }

    return this.getRecinto(id);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.recinto.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Recinto no encontrado');

    const [militaresCount, dependientesCount] = await this.prisma.$transaction([
      this.prisma.militar.count({ where: { recintoId: id } }),
      this.prisma.recinto.count({ where: { cdaDestinoId: id } }),
    ]);
    if (militaresCount > 0) {
      throw new ConflictException(
        `No se puede eliminar: el recinto tiene ${militaresCount} militar(es) asignado(s)`,
      );
    }
    if (dependientesCount > 0) {
      throw new ConflictException(
        `No se puede eliminar: ${dependientesCount} recinto(s) lo tienen configurado como CDA destino`,
      );
    }

    await this.prisma.recinto.delete({ where: { id } });
    return { deleted: true };
  }

  // ---- internos ----
  private async assertCanton(cantonId: number) {
    const c = await this.prisma.canton.findUnique({ where: { id: cantonId } });
    if (!c) throw new BadRequestException('El cantón indicado no existe');
  }

  private async assertCodigoDisponible(codigoRecinto: string) {
    const dup = await this.prisma.recinto.findUnique({ where: { codigoRecinto } });
    if (dup) throw new ConflictException(`Ya existe un recinto con código ${codigoRecinto}`);
  }

  private async getCoords(ids: string[]): Promise<Map<string, { lat: number; lng: number }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ id: string; lat: number; lng: number }[]>`
      SELECT id, ST_Y(ubicacion::geometry) AS lat, ST_X(ubicacion::geometry) AS lng
      FROM recintos
      WHERE id = ANY(${ids}::uuid[])
    `;
    return new Map(rows.map((r) => [r.id, { lat: r.lat, lng: r.lng }]));
  }
}

function toRecintoDto(r: any, coords?: { lat: number; lng: number }): Recinto {
  return {
    id: r.id,
    codigoRecinto: r.codigoRecinto,
    nombre: r.nombre,
    direccion: r.direccion ?? null,
    cantonId: r.cantonId,
    cantonNombre: r.canton?.nombre,
    parroquia: r.parroquia ?? null,
    zona: r.zona ?? null,
    tipo: r.tipo,
    latitud: coords?.lat ?? 0,
    longitud: coords?.lng ?? 0,
    tieneInternet: r.tieneInternet,
    coberturaMovil: r.coberturaMovil,
    numeroElectores: r.numeroElectores ?? null,
    juntasFemeninas: r.juntasFemeninas ?? null,
    juntasMasculinas: r.juntasMasculinas ?? null,
  };
}
