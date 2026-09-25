import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ItemsKitService } from './items-kit.service';
import { PrismaService } from '../db/prisma.service';

describe('ItemsKitService', () => {
  let service: ItemsKitService;

  const prisma = {
    itemKitCatalog: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    kitItemContenido: {
      count: jest.fn(),
    },
  };

  const itemId = '55555555-5555-5555-5555-555555555555';

  function itemRow(overrides: Record<string, unknown> = {}) {
    return {
      id: itemId,
      codigo: 'COMPUTADOR',
      etiqueta: 'Computador',
      activo: true,
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ItemsKitService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ItemsKitService);
  });

  describe('list', () => {
    it('filtra solo ítems activos, ordenados por etiqueta', async () => {
      prisma.itemKitCatalog.findMany.mockResolvedValueOnce([itemRow()]);
      const result = await service.list();
      expect(prisma.itemKitCatalog.findMany).toHaveBeenCalledWith({
        where: { activo: true },
        orderBy: { etiqueta: 'asc' },
      });
      expect(result).toEqual([itemRow()]);
    });
  });

  describe('listAll', () => {
    it('no filtra por activo (incluye inactivos)', async () => {
      prisma.itemKitCatalog.findMany.mockResolvedValueOnce([itemRow(), itemRow({ activo: false })]);
      await service.listAll();
      expect(prisma.itemKitCatalog.findMany).toHaveBeenCalledWith({ orderBy: { etiqueta: 'asc' } });
    });
  });

  describe('create', () => {
    it('lanza ConflictException si el código ya existe', async () => {
      prisma.itemKitCatalog.findUnique.mockResolvedValueOnce(itemRow());
      await expect(service.create('COMPUTADOR', 'Computador')).rejects.toThrow(ConflictException);
      expect(prisma.itemKitCatalog.create).not.toHaveBeenCalled();
    });

    it('crea el ítem si el código está libre', async () => {
      prisma.itemKitCatalog.findUnique.mockResolvedValueOnce(null);
      prisma.itemKitCatalog.create.mockResolvedValueOnce(itemRow());
      const result = await service.create('COMPUTADOR', 'Computador');
      expect(prisma.itemKitCatalog.create).toHaveBeenCalledWith({
        data: { codigo: 'COMPUTADOR', etiqueta: 'Computador' },
      });
      expect(result).toEqual(itemRow());
    });
  });

  describe('update', () => {
    it('lanza NotFoundException si el ítem no existe', async () => {
      prisma.itemKitCatalog.findUnique.mockResolvedValueOnce(null);
      await expect(service.update(itemId, { activo: false })).rejects.toThrow(NotFoundException);
    });

    it('actualiza el ítem si existe', async () => {
      prisma.itemKitCatalog.findUnique.mockResolvedValueOnce(itemRow());
      prisma.itemKitCatalog.update.mockResolvedValueOnce(itemRow({ activo: false }));
      const result = await service.update(itemId, { activo: false });
      expect(prisma.itemKitCatalog.update).toHaveBeenCalledWith({
        where: { id: itemId },
        data: { activo: false },
      });
      expect(result.activo).toBe(false);
    });
  });

  describe('remove', () => {
    it('lanza NotFoundException si el ítem no existe', async () => {
      prisma.itemKitCatalog.findUnique.mockResolvedValueOnce(null);
      await expect(service.remove(itemId)).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si algún kit usa el ítem', async () => {
      prisma.itemKitCatalog.findUnique.mockResolvedValueOnce(itemRow());
      prisma.kitItemContenido.count.mockResolvedValueOnce(3);
      await expect(service.remove(itemId)).rejects.toThrow(BadRequestException);
      expect(prisma.itemKitCatalog.delete).not.toHaveBeenCalled();
    });

    it('elimina el ítem si ningún kit lo usa', async () => {
      prisma.itemKitCatalog.findUnique.mockResolvedValueOnce(itemRow());
      prisma.kitItemContenido.count.mockResolvedValueOnce(0);
      prisma.itemKitCatalog.delete.mockResolvedValueOnce(itemRow());
      await service.remove(itemId);
      expect(prisma.itemKitCatalog.delete).toHaveBeenCalledWith({ where: { id: itemId } });
    });
  });
});
