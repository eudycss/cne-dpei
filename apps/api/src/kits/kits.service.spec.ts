import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { KitsService } from './kits.service';
import { PrismaService } from '../db/prisma.service';

describe('KitsService', () => {
  let service: KitsService;

  const prisma = {
    kitElectoral: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    eventoElectoral: {
      findUnique: jest.fn(),
    },
    usuario: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    recinto: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };

  const eventoId = '22222222-2222-2222-2222-222222222222';
  const kitId = '33333333-3333-3333-3333-333333333333';
  const operadorId = '11111111-1111-1111-1111-111111111111';
  const recintoId = '44444444-4444-4444-4444-444444444444';

  function kitRow(overrides: Record<string, unknown> = {}) {
    return {
      id: kitId,
      eventoId,
      codigoUnico: 'ABCD2345',
      qrPayload: 'ABCD2345',
      nombre: 'Kit 1',
      contenidos: null,
      recintoId: null,
      operadorId: null,
      estado: 'EN_BODEGA',
      creadoEn: new Date('2026-06-19T10:00:00Z'),
      ...overrides,
    };
  }

  // Por defecto BORRADOR con jornada futura: no congelado (HU12-CA6).
  function eventoRow(overrides: Record<string, unknown> = {}) {
    return {
      id: eventoId,
      estado: 'BORRADOR',
      fechaJornada: new Date('2099-01-01'),
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr));

    const moduleRef = await Test.createTestingModule({
      providers: [KitsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(KitsService);
  });

  describe('create', () => {
    it('lanza NotFoundException si el evento no existe', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.create({ eventoId, nombre: 'Kit 1' } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.kitElectoral.create).not.toHaveBeenCalled();
    });

    it('crea el kit con un código único y estado EN_BODEGA', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null); // sin colisión de código
      prisma.kitElectoral.create.mockResolvedValueOnce(kitRow());

      const result = await service.create({ eventoId, nombre: 'Kit 1' } as any);

      expect(result.estado).toBe('EN_BODEGA');
      expect(prisma.kitElectoral.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventoId, estado: 'EN_BODEGA' }),
        }),
      );
      const data = prisma.kitElectoral.create.mock.calls[0][0].data;
      expect(data.codigoUnico).toHaveLength(8);
      expect(data.qrPayload).toBe(data.codigoUnico); // CA2: el QR codifica el código único
    });
  });

  describe('asignar', () => {
    it('lanza NotFoundException si el kit no existe', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.asignar(kitId, { operadorId, recintoId } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza BadRequestException si el usuario no tiene rol OPERADOR_CDA', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findFirst.mockResolvedValueOnce(null);
      await expect(service.asignar(kitId, { operadorId, recintoId } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza NotFoundException si el recinto no existe', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findFirst.mockResolvedValueOnce({ id: operadorId });
      prisma.recinto.findUnique.mockResolvedValueOnce(null);
      await expect(service.asignar(kitId, { operadorId, recintoId } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza ConflictException si el operador ya tiene kits en otro recinto', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findFirst.mockResolvedValueOnce({ id: operadorId });
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        { recintoId: '99999999-9999-9999-9999-999999999999' },
      ]);
      await expect(service.asignar(kitId, { operadorId, recintoId } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.kitElectoral.update).not.toHaveBeenCalled();
    });

    it('asigna el kit y pasa de EN_BODEGA a ASIGNADO', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ estado: 'EN_BODEGA' }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findFirst.mockResolvedValueOnce({ id: operadorId });
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]); // sin conflictos
      prisma.kitElectoral.update.mockResolvedValueOnce(
        kitRow({ estado: 'ASIGNADO', operadorId, recintoId }),
      );

      const result = await service.asignar(kitId, { operadorId, recintoId } as any);

      expect(result.estado).toBe('ASIGNADO');
      expect(prisma.kitElectoral.update).toHaveBeenCalledWith({
        where: { id: kitId },
        data: { operadorId, recintoId, estado: 'ASIGNADO' },
      });
    });

    // HU12-CA6: freeze de asignaciones el día de la jornada electoral.
    it('lanza BadRequestException con frozen:true si el evento ya inició su jornada y no hay justificación', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(
        eventoRow({ estado: 'ACTIVO', fechaJornada: new Date('2020-01-01') }),
      );
      await expect(service.asignar(kitId, { operadorId, recintoId } as any)).rejects.toMatchObject(
        { response: { frozen: true } },
      );
      expect(prisma.kitElectoral.update).not.toHaveBeenCalled();
    });

    it('permite reasignar con jornada iniciada si se envía justificación', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ estado: 'EN_BODEGA' }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(
        eventoRow({ estado: 'ACTIVO', fechaJornada: new Date('2020-01-01') }),
      );
      prisma.usuario.findFirst.mockResolvedValueOnce({ id: operadorId });
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.kitElectoral.update.mockResolvedValueOnce(
        kitRow({ estado: 'ASIGNADO', operadorId, recintoId }),
      );

      const result = await service.asignar(kitId, {
        operadorId,
        recintoId,
        justificacion: 'Kit dañado, se reemplaza en campo',
      } as any);

      expect(result.estado).toBe('ASIGNADO');
    });
  });

  describe('desasignar', () => {
    it('lanza NotFoundException si el kit no existe', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.desasignar(kitId)).rejects.toThrow(NotFoundException);
    });

    it('limpia operador/recinto y vuelve a EN_BODEGA si estaba ASIGNADO', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(
        kitRow({ estado: 'ASIGNADO', operadorId, recintoId }),
      );
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.kitElectoral.update.mockResolvedValueOnce(kitRow({ estado: 'EN_BODEGA' }));

      await service.desasignar(kitId);

      expect(prisma.kitElectoral.update).toHaveBeenCalledWith({
        where: { id: kitId },
        data: { operadorId: null, recintoId: null, estado: 'EN_BODEGA' },
      });
    });

    it('lanza BadRequestException con frozen:true si el evento ya inició su jornada y no hay justificación', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(
        kitRow({ estado: 'ASIGNADO', operadorId, recintoId }),
      );
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(
        eventoRow({ estado: 'ACTIVO', fechaJornada: new Date('2020-01-01') }),
      );
      await expect(service.desasignar(kitId)).rejects.toMatchObject({ response: { frozen: true } });
      expect(prisma.kitElectoral.update).not.toHaveBeenCalled();
    });
  });

  describe('generatePdfQr', () => {
    it('lanza BadRequestException si no se encuentran kits', async () => {
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      await expect(service.generatePdfQr({ kitIds: [kitId] } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('genera un PDF (Buffer no vacío) con las etiquetas QR', async () => {
      prisma.kitElectoral.findMany.mockResolvedValueOnce([kitRow()]);
      const pdf = await service.generatePdfQr({ kitIds: [kitId] } as any);
      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.length).toBeGreaterThan(0);
    });
  });

  describe('bulkUpload', () => {
    function csvFile(csv: string) {
      return {
        originalname: 'kits.csv',
        mimetype: 'text/csv',
        buffer: Buffer.from(csv, 'utf8'),
      } as Express.Multer.File;
    }

    it('lanza BadRequestException si no se envía archivo', async () => {
      await expect(service.bulkUpload(undefined as any, eventoId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza NotFoundException si el evento no existe', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.bulkUpload(csvFile('nombre\nKit A'), eventoId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza BadRequestException si el archivo no tiene filas', async () => {
      // parseRows lanza antes de tocar usuario/recinto/kit, así que solo se consulta el evento.
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      await expect(
        service.bulkUpload(csvFile('nombre,contenidos,cedula_operador,codigo_recinto'), eventoId),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException con frozen:true si el evento ya inició su jornada (sin excepción posible)', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(
        eventoRow({ estado: 'ACTIVO', fechaJornada: new Date('2020-01-01') }),
      );
      await expect(
        service.bulkUpload(csvFile('nombre\nKit A'), eventoId),
      ).rejects.toMatchObject({ response: { frozen: true } });
      expect(prisma.kitElectoral.create).not.toHaveBeenCalled();
    });

    it('crea kits asignados y en bodega, y reporta operador/recinto inexistentes', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findMany.mockResolvedValueOnce([{ id: operadorId, cedula: '1002003004' }]);
      prisma.recinto.findMany.mockResolvedValueOnce([{ id: recintoId, codigoRecinto: '28' }]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]); // sin asignaciones previas
      prisma.kitElectoral.findUnique.mockResolvedValue(null); // generarCodigoUnico: sin colisión
      prisma.kitElectoral.create.mockResolvedValue(kitRow());

      const csv = [
        'nombre,contenidos,cedula_operador,codigo_recinto',
        'Kit A,Acta,1002003004,28', // asignado
        'Kit B,,,', // bodega
        'Kit C,,9999999999,28', // operador inexistente -> error
        'Kit D,,1002003004,99', // recinto inexistente -> error
      ].join('\n');

      const result = await service.bulkUpload(csvFile(csv), eventoId);

      expect(result.creados).toBe(2);
      expect(result.errores).toHaveLength(2);
      expect(prisma.kitElectoral.create).toHaveBeenCalledTimes(2);
      const estados = prisma.kitElectoral.create.mock.calls.map((c) => c[0].data.estado);
      expect(estados).toContain('ASIGNADO'); // Kit A
      expect(estados).toContain('EN_BODEGA'); // Kit B
    });

    it('reporta error si un operador queda con kits en dos recintos distintos', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findMany.mockResolvedValueOnce([{ id: operadorId, cedula: '1002003004' }]);
      prisma.recinto.findMany.mockResolvedValueOnce([
        { id: recintoId, codigoRecinto: '28' },
        { id: '99999999-9999-9999-9999-999999999999', codigoRecinto: '30' },
      ]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.kitElectoral.findUnique.mockResolvedValue(null);
      prisma.kitElectoral.create.mockResolvedValue(kitRow());

      const csv = [
        'nombre,contenidos,cedula_operador,codigo_recinto',
        'Kit A,,1002003004,28', // asigna recinto 28
        'Kit B,,1002003004,30', // mismo operador, otro recinto -> error
      ].join('\n');

      const result = await service.bulkUpload(csvFile(csv), eventoId);

      expect(result.creados).toBe(1);
      expect(result.errores).toHaveLength(1);
      expect(result.errores[0].error).toMatch(/otro recinto/i);
    });
  });
});
