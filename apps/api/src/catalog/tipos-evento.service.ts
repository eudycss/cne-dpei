import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TipoEventoCatalog } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class TiposEventoService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<TipoEventoCatalog[]> {
    return this.prisma.tipoEventoCatalog.findMany({
      where: { activo: true },
      orderBy: { etiqueta: 'asc' },
    });
  }

  async listAll(): Promise<TipoEventoCatalog[]> {
    return this.prisma.tipoEventoCatalog.findMany({ orderBy: { etiqueta: 'asc' } });
  }

  async create(codigo: string, etiqueta: string): Promise<TipoEventoCatalog> {
    const existing = await this.prisma.tipoEventoCatalog.findUnique({ where: { codigo } });
    if (existing) throw new ConflictException(`El código '${codigo}' ya existe`);
    return this.prisma.tipoEventoCatalog.create({ data: { codigo, etiqueta } });
  }

  async update(id: string, data: { etiqueta?: string; activo?: boolean }): Promise<TipoEventoCatalog> {
    const existing = await this.prisma.tipoEventoCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tipo de evento no encontrado');
    return this.prisma.tipoEventoCatalog.update({ where: { id }, data });
  }

  async remove(id: string): Promise<TipoEventoCatalog> {
    const existing = await this.prisma.tipoEventoCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tipo de evento no encontrado');
    const enUso = await this.prisma.eventoElectoral.count({ where: { tipo: existing.codigo } });
    if (enUso > 0) throw new BadRequestException(`No se puede eliminar: ${enUso} evento(s) usan este tipo`);
    return this.prisma.tipoEventoCatalog.delete({ where: { id } });
  }

  async assertTipoValido(codigo: string): Promise<void> {
    const t = await this.prisma.tipoEventoCatalog.findUnique({ where: { codigo } });
    if (!t || !t.activo) throw new BadRequestException(`Tipo de evento inválido: '${codigo}'`);
  }
}
