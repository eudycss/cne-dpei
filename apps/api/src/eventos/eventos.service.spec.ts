import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { EventosService } from './eventos.service';
import { PrismaService } from '../db/prisma.service';

describe('EventosService', () => {
  let service: EventosService;

  const prisma = {
    eventoElectoral: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    configAlerta: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    asignacionSupervisor: { findMany: jest.fn() },
    eventoTracking: { findMany: jest.fn() },
    usuario: { findMany: jest.fn() },
    tipoEventoCatalog: { findUnique: jest.fn() },
  };

  const eventoId = '22222222-2222-2222-2222-222222222222';

  function eventoRow(overrides: Record<string, unknown> = {}) {
    return {
      id: eventoId,
      nombre: 'Elección 2026',
      tipo: 'ELECCION_GENERAL',
      fechaJornada: new Date('2026-07-01T00:00:00Z'),
      descripcion: null,
      estado: 'BORRADOR',
      creadoEn: new Date('2026-06-19T10:00:00Z'),
      cerradoEn: null,
      ...overrides,
    };
  }

  const configRow = {
    umbralLlegadaRecintoMin: 60,
    umbralLlegadaDpiMin: 60,
    umbralSinSyncMin: 30,
    margenLlegadaMetros: 150,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [EventosService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(EventosService);
  });

  describe('get', () => {
    it('lanza NotFoundException si el evento no existe', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.get(eventoId)).rejects.toThrow(NotFoundException);
    });

    it('devuelve el evento con su configuración de alertas', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.configAlerta.findUnique.mockResolvedValueOnce(configRow);

      const result = await service.get(eventoId);

      expect(result.id).toBe(eventoId);
      expect(result.configAlertas).toEqual(configRow);
    });
  });

  describe('create', () => {
    it('crea el evento junto con su configuración de alertas por defecto', async () => {
      prisma.tipoEventoCatalog.findUnique.mockResolvedValueOnce({ codigo: 'ELECCION_GENERAL', activo: true });
      prisma.eventoElectoral.create.mockResolvedValueOnce(eventoRow());
      prisma.configAlerta.create.mockResolvedValueOnce(configRow);
      // this.get(id) interno:
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.configAlerta.findUnique.mockResolvedValueOnce(configRow);

      const result = await service.create({
        nombre: 'Elección 2026',
        tipo: 'ELECCION_GENERAL',
        fechaJornada: '2026-07-01',
      } as any);

      expect(result.estado).toBe('BORRADOR');
      expect(prisma.configAlerta.create).toHaveBeenCalledWith({ data: { eventoId } });
    });
  });

  describe('update', () => {
    it('lanza NotFoundException si el evento no existe', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.update(eventoId, { nombre: 'X' } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza BadRequestException si el evento no está en BORRADOR', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow({ estado: 'ACTIVO' }));
      await expect(service.update(eventoId, { nombre: 'X' } as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.eventoElectoral.update).not.toHaveBeenCalled();
    });

    it('actualiza un evento en BORRADOR', async () => {
      prisma.eventoElectoral.findUnique
        .mockResolvedValueOnce(eventoRow({ estado: 'BORRADOR' })) // existing
        .mockResolvedValueOnce(eventoRow({ nombre: 'Nuevo nombre' })); // get() final
      prisma.configAlerta.findUnique.mockResolvedValueOnce(configRow);

      const result = await service.update(eventoId, { nombre: 'Nuevo nombre' } as any);

      expect(result.nombre).toBe('Nuevo nombre');
      expect(prisma.eventoElectoral.update).toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('lanza NotFoundException si el evento no existe', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.activate(eventoId)).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si el evento está CERRADO', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow({ estado: 'CERRADO' }));
      await expect(service.activate(eventoId)).rejects.toThrow(BadRequestException);
    });

    it('lanza ConflictException si ya existe otro evento ACTIVO', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow({ estado: 'BORRADOR' }));
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce({ id: 'otro', nombre: 'Otro evento' });
      await expect(service.activate(eventoId)).rejects.toThrow(ConflictException);
      expect(prisma.eventoElectoral.update).not.toHaveBeenCalled();
    });

    it('activa un evento en BORRADOR cuando no hay otro activo', async () => {
      prisma.eventoElectoral.findUnique
        .mockResolvedValueOnce(eventoRow({ estado: 'BORRADOR' })) // verificación inicial
        .mockResolvedValueOnce(eventoRow({ estado: 'ACTIVO' })); // get() final
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null); // ningún activo
      prisma.configAlerta.findUnique.mockResolvedValueOnce(configRow);

      const result = await service.activate(eventoId);

      expect(result.estado).toBe('ACTIVO');
      expect(prisma.eventoElectoral.update).toHaveBeenCalledWith({
        where: { id: eventoId },
        data: { estado: 'ACTIVO' },
      });
    });
  });

  describe('close', () => {
    it('lanza BadRequestException si no se confirma el cierre', async () => {
      await expect(service.close(eventoId, false)).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el evento no está ACTIVO', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow({ estado: 'BORRADOR' }));
      await expect(service.close(eventoId, true)).rejects.toThrow(BadRequestException);
    });

    it('exige justificación si hay operadores sin llegada al DPI', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow({ estado: 'ACTIVO' }));
      prisma.asignacionSupervisor.findMany.mockResolvedValueOnce([{ operadorId: 'op1' }]);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([]); // ninguno llegó
      prisma.usuario.findMany.mockResolvedValueOnce([
        { id: 'op1', nombres: 'Ana', apellidos: 'López' },
      ]);

      await expect(service.close(eventoId, true)).rejects.toThrow(BadRequestException);
      expect(prisma.eventoElectoral.update).not.toHaveBeenCalled();
    });

    it('cierra el evento cuando todos llegaron al DPI (sin pendientes)', async () => {
      prisma.eventoElectoral.findUnique
        .mockResolvedValueOnce(eventoRow({ estado: 'ACTIVO' })) // verificación
        .mockResolvedValueOnce(eventoRow({ estado: 'CERRADO', cerradoEn: new Date() })); // get()
      prisma.asignacionSupervisor.findMany.mockResolvedValueOnce([]); // sin asignaciones -> sin pendientes
      prisma.configAlerta.findUnique.mockResolvedValueOnce(configRow);

      const result = await service.close(eventoId, true);

      expect(result.estado).toBe('CERRADO');
      expect(prisma.eventoElectoral.update).toHaveBeenCalledWith({
        where: { id: eventoId },
        data: expect.objectContaining({ estado: 'CERRADO' }),
      });
    });
  });

  describe('updateConfigAlertas', () => {
    it('lanza NotFoundException si el evento no existe', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.updateConfigAlertas(eventoId, configRow as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('hace upsert de la configuración y la devuelve', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow({ estado: 'ACTIVO' }));
      prisma.configAlerta.upsert.mockResolvedValueOnce(configRow);

      const result = await service.updateConfigAlertas(eventoId, configRow as any);

      expect(result).toEqual(configRow);
      expect(prisma.configAlerta.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { eventoId } }),
      );
    });
  });
});
