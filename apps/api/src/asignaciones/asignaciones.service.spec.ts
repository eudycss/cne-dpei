import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AsignacionesService } from './asignaciones.service';
import { PrismaService } from '../db/prisma.service';

describe('AsignacionesService', () => {
  let service: AsignacionesService;

  const prisma = {
    asignacionSupervisor: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    usuario: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    eventoElectoral: {
      findUnique: jest.fn(),
    },
  };

  const eventoId = '22222222-2222-2222-2222-222222222222';
  const operadorId = '11111111-1111-1111-1111-111111111111';
  const supervisorId = '55555555-5555-5555-5555-555555555555';
  const asignacionId = '66666666-6666-6666-6666-666666666666';

  const input = { eventoId, operadorId, supervisorId };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [AsignacionesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AsignacionesService);
  });

  describe('list', () => {
    it('devuelve [] si no hay asignaciones para el evento', async () => {
      prisma.asignacionSupervisor.findMany.mockResolvedValueOnce([]);
      const result = await service.list(eventoId);
      expect(result).toEqual([]);
      expect(prisma.usuario.findMany).not.toHaveBeenCalled();
    });

    it('resuelve nombres de operador y supervisor desde usuarios', async () => {
      prisma.asignacionSupervisor.findMany.mockResolvedValueOnce([
        { id: asignacionId, eventoId, operadorId, supervisorId, creadoEn: new Date('2026-06-19T10:00:00Z') },
      ]);
      prisma.usuario.findMany.mockResolvedValueOnce([
        { id: operadorId, nombres: 'Ana', apellidos: 'López', cedula: '1002003004' },
        { id: supervisorId, nombres: 'Beto', apellidos: 'Ruiz', cedula: '1002003005' },
      ]);

      const result = await service.list(eventoId);

      expect(result[0].operadorNombre).toBe('Ana López');
      expect(result[0].supervisorNombre).toBe('Beto Ruiz');
      expect(result[0].operadorCedula).toBe('1002003004');
    });
  });

  describe('upsert', () => {
    it('lanza NotFoundException si el evento no existe', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.upsert(input as any)).rejects.toThrow(NotFoundException);
      expect(prisma.asignacionSupervisor.upsert).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el operador no tiene rol OPERADOR_CDA', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce({ id: eventoId });
      prisma.usuario.findFirst.mockResolvedValueOnce(null); // operador inválido
      await expect(service.upsert(input as any)).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el supervisor no tiene rol TECNICO_SUPERVISOR', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce({ id: eventoId });
      prisma.usuario.findFirst
        .mockResolvedValueOnce({ id: operadorId, nombres: 'Ana', apellidos: 'López', cedula: '1002003004' })
        .mockResolvedValueOnce(null); // supervisor inválido
      await expect(service.upsert(input as any)).rejects.toThrow(BadRequestException);
      expect(prisma.asignacionSupervisor.upsert).not.toHaveBeenCalled();
    });

    it('crea/actualiza la asignación y devuelve el DTO con nombres', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce({ id: eventoId });
      prisma.usuario.findFirst
        .mockResolvedValueOnce({ id: operadorId, nombres: 'Ana', apellidos: 'López', cedula: '1002003004' })
        .mockResolvedValueOnce({ id: supervisorId, nombres: 'Beto', apellidos: 'Ruiz', cedula: '1002003005' });
      prisma.asignacionSupervisor.upsert.mockResolvedValueOnce({
        id: asignacionId,
        eventoId,
        operadorId,
        supervisorId,
        creadoEn: new Date('2026-06-19T10:00:00Z'),
      });

      const result = await service.upsert(input as any);

      expect(result.operadorNombre).toBe('Ana López');
      expect(result.supervisorNombre).toBe('Beto Ruiz');
      expect(prisma.asignacionSupervisor.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventoId_operadorId: { eventoId, operadorId } },
          update: { supervisorId },
        }),
      );
    });
  });

  describe('remove', () => {
    it('lanza NotFoundException si la asignación no existe', async () => {
      prisma.asignacionSupervisor.findUnique.mockResolvedValueOnce(null);
      await expect(service.remove(asignacionId)).rejects.toThrow(NotFoundException);
      expect(prisma.asignacionSupervisor.delete).not.toHaveBeenCalled();
    });

    it('elimina la asignación existente', async () => {
      prisma.asignacionSupervisor.findUnique.mockResolvedValueOnce({ id: asignacionId });
      await service.remove(asignacionId);
      expect(prisma.asignacionSupervisor.delete).toHaveBeenCalledWith({ where: { id: asignacionId } });
    });
  });
});
