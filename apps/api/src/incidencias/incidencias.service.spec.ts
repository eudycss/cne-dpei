import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { IncidenciasService } from './incidencias.service';
import { PrismaService } from '../db/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

describe('IncidenciasService', () => {
  let service: IncidenciasService;

  const prisma = {
    eventoElectoral: {
      findFirst: jest.fn(),
    },
    recinto: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    kitElectoral: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    usuario: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    asignacionSupervisor: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    incidencia: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    incidenciaComentario: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };

  const notifications = {
    encolarIncidencia: jest.fn(),
  };

  const storage = {
    saveEncrypted: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr));

    const moduleRef = await Test.createTestingModule({
      providers: [
        IncidenciasService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = moduleRef.get(IncidenciasService);
  });

  describe('create', () => {
    const operadorId = '11111111-1111-1111-1111-111111111111';
    const eventoId = '22222222-2222-2222-2222-222222222222';
    const incidenciaId = '33333333-3333-3333-3333-333333333333';

    function mockFindOneRaw() {
      // findOneRaw usa prisma.incidencia.findMany + usuario/recinto/kit + $queryRaw (ubicación)
      prisma.incidencia.findMany.mockResolvedValueOnce([
        {
          id: incidenciaId,
          eventoId,
          operadorId,
          recintoId: null,
          kitId: null,
          tipo: 'OTRO',
          descripcion: 'Descripción de prueba',
          fotoUrl: null,
          estado: 'ABIERTA',
          reportadoEn: new Date('2026-06-19T10:00:00Z'),
          desdeOffline: false,
        },
      ]);
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Juan', apellidos: 'Pérez' });
      prisma.$queryRaw.mockResolvedValueOnce([]); // ubicación: sin lat/lng
    }

    it('crea la incidencia sin foto ni lat/lng y notifica al supervisor', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValue({ id: eventoId });
      // INSERT vía $queryRaw devuelve el id creado
      prisma.$queryRaw.mockResolvedValueOnce([{ id: incidenciaId }]);
      // operador para armar el payload de notificación
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Juan', apellidos: 'Pérez' });
      mockFindOneRaw();

      const result = await service.create(operadorId, {
        tipo: 'OTRO',
        descripcion: 'Descripción de prueba',
      } as any);

      expect(result.id).toBe(incidenciaId);
      expect(result.tipo).toBe('OTRO');
      expect(notifications.encolarIncidencia).toHaveBeenCalledTimes(1);
      expect(notifications.encolarIncidencia).toHaveBeenCalledWith(
        expect.objectContaining({
          operadorId,
          eventoId,
          payload: expect.objectContaining({
            incidenciaId,
            tipo: 'OTRO',
          }),
        }),
      );
      expect(storage.saveEncrypted).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si no hay evento electoral ACTIVO', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValue(null);

      await expect(
        service.create(operadorId, { tipo: 'OTRO', descripcion: 'x' } as any),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(notifications.encolarIncidencia).not.toHaveBeenCalled();
    });
  });

  describe('updateEstado', () => {
    const id = '44444444-4444-4444-4444-444444444444';
    const viewerId = '55555555-5555-5555-5555-555555555555';

    it('lanza BadRequestException si la incidencia ya está CERRADA y no actualiza', async () => {
      // checkAccess: viewer es ADMINISTRADOR -> retorna de inmediato sin tocar prisma.incidencia
      prisma.incidencia.findUnique.mockResolvedValueOnce({ id, estado: 'CERRADA' });

      await expect(
        service.updateEstado(id, viewerId, ['ADMINISTRADOR'], { estado: 'ATENDIDA' } as any),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.incidencia.update).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    const id = '66666666-6666-6666-6666-666666666666';
    const viewerId = '77777777-7777-7777-7777-777777777777';
    const operadorId = '88888888-8888-8888-8888-888888888888';

    it('lanza NotFoundException si el supervisor no está asignado al operador de la incidencia', async () => {
      // checkAccess: no es admin -> busca la incidencia para conocer su operadorId
      prisma.incidencia.findUnique.mockResolvedValueOnce({ operadorId });
      // luego busca la asignación supervisor->operador, no existe
      prisma.asignacionSupervisor.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.findOne(id, viewerId, ['TECNICO_SUPERVISOR'] as any),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.asignacionSupervisor.findFirst).toHaveBeenCalledWith({
        where: { supervisorId: viewerId, operadorId },
        select: { id: true },
      });
      // no debió continuar a leer la incidencia completa
      expect(prisma.incidencia.findMany).not.toHaveBeenCalled();
    });
  });

  describe('listMias', () => {
    const operadorId = '99999999-9999-9999-9999-999999999999';

    it('incluye operadorId del llamante en el where de paginación', async () => {
      prisma.incidencia.count.mockResolvedValueOnce(0);
      prisma.incidencia.findMany.mockResolvedValueOnce([]);
      prisma.usuario.findMany.mockResolvedValueOnce([]);

      const result = await service.listMias({ operadorId });

      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
      expect(prisma.incidencia.count).toHaveBeenCalledWith({
        where: { operadorId },
      });
      expect(prisma.incidencia.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { operadorId },
        }),
      );
    });
  });
});
