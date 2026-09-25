import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ItemKitCatalog } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class ItemsKitService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ItemKitCatalog[]> {
    return this.prisma.itemKitCatalog.findMany({
      where: { activo: true },
      orderBy: { etiqueta: 'asc' },
    });
  }

  async listAll(): Promise<ItemKitCatalog[]> {
    return this.prisma.itemKitCatalog.findMany({ orderBy: { etiqueta: 'asc' } });
  }

  async create(codigo: string, etiqueta: string): Promise<ItemKitCatalog> {
    const existing = await this.prisma.itemKitCatalog.findUnique({ where: { codigo } });
    if (existing) throw new ConflictException(`El código '${codigo}' ya existe`);
    return this.prisma.itemKitCatalog.create({ data: { codigo, etiqueta } });
  }

  async update(id: string, data: { etiqueta?: string; activo?: boolean }): Promise<ItemKitCatalog> {
    const existing = await this.prisma.itemKitCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ítem de kit no encontrado');
    return this.prisma.itemKitCatalog.update({ where: { id }, data });
  }

  async remove(id: string): Promise<ItemKitCatalog> {
    const existing = await this.prisma.itemKitCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ítem de kit no encontrado');
    const enUso = await this.prisma.kitItemContenido.count({ where: { itemId: id } });
    if (enUso > 0) throw new BadRequestException(`No se puede eliminar: ${enUso} kit(s) usan este ítem`);
    return this.prisma.itemKitCatalog.delete({ where: { id } });
  }
}
