import { Injectable, NotFoundException } from '@nestjs/common';
import type { Canton, Paginated, Recinto } from '@cne/shared-types';
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
    return {
      items: items.map(toRecintoDto),
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
    return toRecintoDto(r);
  }

  async listCantones(): Promise<Canton[]> {
    const cantones = await this.prisma.canton.findMany({ orderBy: { nombre: 'asc' } });
    return cantones.map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre }));
  }
}

function toRecintoDto(r: any): Recinto {
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
    tieneInternet: r.tieneInternet,
    coberturaMovil: r.coberturaMovil,
    numeroElectores: r.numeroElectores ?? null,
  };
}
