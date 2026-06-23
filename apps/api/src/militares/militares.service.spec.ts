import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { MilitaresService } from './militares.service';
import { PrismaService } from '../db/prisma.service';

describe('MilitaresService', () => {
  let service: MilitaresService;

  const prisma = {
    militar: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    recinto: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };

  const recintoId = '44444444-4444-4444-4444-444444444444';
  const militarId = '77777777-7777-7777-7777-777777777777';

  const validInput = {
    cedula: '1002003004',
    nombres: 'Pedro',
    apellidos: 'Suárez',
    recintoId,
  };

  function militarRow(overrides: Record<string, unknown> = {}) {
    return {
      id: militarId,
      cedula: validInput.cedula,
      nombres: validInput.nombres,
      apellidos: validInput.apellidos,
      recintoId,
      recinto: { nombre: 'Recinto 1', codigoRecinto: '28' },
      creadoEn: new Date('2026-06-19T10:00:00Z'),
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [MilitaresService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(MilitaresService);
  });

  describe('create', () => {
    it('lanza BadRequestException si el recinto no existe', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(null);
      await expect(service.create(validInput as any)).rejects.toThrow(BadRequestException);
      expect(prisma.militar.create).not.toHaveBeenCalled();
    });

    it('crea el militar cuando el recinto existe', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId });
      prisma.militar.create.mockResolvedValueOnce(militarRow());

      const result = await service.create(validInput as any);

      expect(result.id).toBe(militarId);
      expect(result.recintoNombre).toBe('Recinto 1');
      expect(prisma.militar.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('lanza NotFoundException si el militar no existe', async () => {
      prisma.militar.findUnique.mockResolvedValueOnce(null);
      await expect(service.update(militarId, { nombres: 'X' } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza BadRequestException si el nuevo recinto no existe', async () => {
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow());
      prisma.recinto.findUnique.mockResolvedValueOnce(null); // recinto nuevo inválido
      await expect(
        service.update(militarId, { recintoId: '55555555-5555-5555-5555-555555555555' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.militar.update).not.toHaveBeenCalled();
    });

    it('actualiza el militar existente', async () => {
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow());
      prisma.militar.update.mockResolvedValueOnce(militarRow({ nombres: 'Pablo' }));

      const result = await service.update(militarId, { nombres: 'Pablo' } as any);

      expect(result.nombres).toBe('Pablo');
      expect(prisma.militar.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lanza NotFoundException si el militar no existe', async () => {
      prisma.militar.findUnique.mockResolvedValueOnce(null);
      await expect(service.remove(militarId)).rejects.toThrow(NotFoundException);
      expect(prisma.militar.delete).not.toHaveBeenCalled();
    });

    it('elimina el militar existente', async () => {
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow());
      const result = await service.remove(militarId);
      expect(result).toEqual({ deleted: true });
      expect(prisma.militar.delete).toHaveBeenCalledWith({ where: { id: militarId } });
    });
  });

  describe('bulkUpload', () => {
    it('lanza BadRequestException si no se envía archivo', async () => {
      await expect(service.bulkUpload(undefined as any)).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el formato no es soportado', async () => {
      const file = {
        originalname: 'militares.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('x'),
      } as Express.Multer.File;
      await expect(service.bulkUpload(file)).rejects.toThrow(BadRequestException);
    });

    it('crea filas válidas, reporta inválidas y recintos inexistentes (CSV)', async () => {
      // '28' existe; '99' no está en la BD
      prisma.recinto.findMany.mockResolvedValueOnce([{ id: recintoId, codigoRecinto: '28' }]);
      prisma.militar.create.mockResolvedValue(militarRow());

      const csv = [
        'cedula,nombres,apellidos,codigo_recinto',
        '1002003004,Pedro,Suarez,28', // válida
        '1002003005,Maria,Lopez,99', // recinto inexistente
        '12,Bad,Row,28', // cédula inválida
      ].join('\n');
      const file = {
        originalname: 'militares.csv',
        mimetype: 'text/csv',
        buffer: Buffer.from(csv, 'utf8'),
      } as Express.Multer.File;

      const result = await service.bulkUpload(file);

      expect(result.creados).toBe(1);
      expect(result.errores).toHaveLength(2);
      expect(prisma.militar.create).toHaveBeenCalledTimes(1);
    });
  });
});
