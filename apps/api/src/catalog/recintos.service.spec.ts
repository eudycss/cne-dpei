import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { RecintosService } from './recintos.service';
import { PrismaService } from '../db/prisma.service';

describe('RecintosService', () => {
  let service: RecintosService;

  const prisma = {
    recinto: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    canton: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    militar: { count: jest.fn() },
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };

  const recintoId = '44444444-4444-4444-4444-444444444444';

  function recintoRow(overrides: Record<string, unknown> = {}) {
    return {
      id: recintoId,
      codigoRecinto: 'R-100',
      nombre: 'Recinto X',
      direccion: null,
      cantonId: 1,
      canton: { nombre: 'Ibarra' },
      parroquia: null,
      zona: null,
      tipo: 'CDA',
      tieneInternet: false,
      coberturaMovil: false,
      numeroElectores: null,
      juntasFemeninas: null,
      juntasMasculinas: null,
      ...overrides,
    };
  }

  const validInput = {
    codigoRecinto: 'R-100',
    nombre: 'Recinto X',
    cantonId: 1,
    tipo: 'CDA' as const,
    latitud: 0.35,
    longitud: -78.11,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr));
    prisma.$queryRaw.mockResolvedValue([]); // getCoords sin coords por defecto

    const moduleRef = await Test.createTestingModule({
      providers: [RecintosService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(RecintosService);
  });

  describe('getRecinto', () => {
    it('lanza NotFoundException si el recinto no existe', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(null);
      await expect(service.getRecinto(recintoId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('lanza BadRequestException si el cantón no existe', async () => {
      prisma.canton.findUnique.mockResolvedValueOnce(null);
      await expect(service.create(validInput as any)).rejects.toThrow(BadRequestException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('lanza ConflictException si el código de recinto ya existe', async () => {
      prisma.canton.findUnique.mockResolvedValueOnce({ id: 1 });
      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow()); // código ocupado
      await expect(service.create(validInput as any)).rejects.toThrow(ConflictException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('inserta el recinto cuando el cantón existe y el código está libre', async () => {
      prisma.canton.findUnique.mockResolvedValueOnce({ id: 1 });
      prisma.recinto.findUnique
        .mockResolvedValueOnce(null) // código libre
        .mockResolvedValueOnce(recintoRow()); // getRecinto() final
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const result = await service.create(validInput as any);

      expect(result.codigoRecinto).toBe('R-100');
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1); // el INSERT raw
    });
  });

  describe('update', () => {
    it('lanza NotFoundException si el recinto no existe', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(null);
      await expect(service.update(recintoId, { nombre: 'X' } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza ConflictException si el nuevo código ya está en uso', async () => {
      prisma.recinto.findUnique
        .mockResolvedValueOnce(recintoRow({ codigoRecinto: 'R-100' })) // existing
        .mockResolvedValueOnce(recintoRow({ id: 'otro', codigoRecinto: 'R-200' })); // dup del nuevo código
      await expect(service.update(recintoId, { codigoRecinto: 'R-200' } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.recinto.update).not.toHaveBeenCalled();
    });

    it('actualiza un recinto existente', async () => {
      prisma.recinto.findUnique
        .mockResolvedValueOnce(recintoRow()) // existing
        .mockResolvedValueOnce(recintoRow({ nombre: 'Recinto Renombrado' })); // getRecinto()
      prisma.recinto.update.mockResolvedValueOnce(recintoRow({ nombre: 'Recinto Renombrado' }));

      const result = await service.update(recintoId, { nombre: 'Recinto Renombrado' } as any);

      expect(result.nombre).toBe('Recinto Renombrado');
      expect(prisma.recinto.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lanza NotFoundException si el recinto no existe', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(null);
      await expect(service.remove(recintoId)).rejects.toThrow(NotFoundException);
    });

    it('lanza ConflictException si el recinto tiene militares asignados', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow());
      prisma.militar.count.mockResolvedValueOnce(3); // militares
      prisma.recinto.count.mockResolvedValueOnce(0);
      await expect(service.remove(recintoId)).rejects.toThrow(ConflictException);
      expect(prisma.recinto.delete).not.toHaveBeenCalled();
    });

    it('lanza ConflictException si otros recintos lo usan como CDA destino', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow());
      prisma.militar.count.mockResolvedValueOnce(0);
      prisma.recinto.count.mockResolvedValueOnce(2); // dependientes
      await expect(service.remove(recintoId)).rejects.toThrow(ConflictException);
      expect(prisma.recinto.delete).not.toHaveBeenCalled();
    });

    it('elimina el recinto sin dependencias', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow());
      prisma.militar.count.mockResolvedValueOnce(0);
      prisma.recinto.count.mockResolvedValueOnce(0);

      const result = await service.remove(recintoId);

      expect(result).toEqual({ deleted: true });
      expect(prisma.recinto.delete).toHaveBeenCalledWith({ where: { id: recintoId } });
    });
  });

  describe('bulkUpload', () => {
    it('lanza BadRequestException si no se envía archivo', async () => {
      await expect(service.bulkUpload(undefined as any)).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el formato no es soportado', async () => {
      const file = {
        originalname: 'recintos.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('x'),
      } as Express.Multer.File;
      await expect(service.bulkUpload(file)).rejects.toThrow(BadRequestException);
    });

    it('crea nuevos, actualiza existentes y reporta cantones inexistentes (CSV)', async () => {
      prisma.canton.findMany.mockResolvedValueOnce([{ id: 1, codigo: '10' }]);
      prisma.recinto.findMany.mockResolvedValueOnce([
        { id: 'rid-exist', codigoRecinto: 'R-EXIST' },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const csv = [
        'codigo_recinto,nombre,canton_codigo,tipo,latitud,longitud',
        'R-NEW,Nuevo,10,CDA,0.35,-78.11', // crear
        'R-EXIST,Existe,10,NO_CDA,0.36,-78.12', // actualizar
        'R-BAD,Malo,99,CDA,0.37,-78.13', // cantón inexistente -> error
      ].join('\n');
      const file = {
        originalname: 'recintos.csv',
        mimetype: 'text/csv',
        buffer: Buffer.from(csv, 'utf8'),
      } as Express.Multer.File;

      const result = await service.bulkUpload(file);

      expect(result.creados).toBe(1);
      expect(result.actualizados).toBe(1);
      expect(result.errores).toHaveLength(1);
    });
  });
});
