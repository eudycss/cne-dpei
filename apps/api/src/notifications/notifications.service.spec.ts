import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { NotificationsService } from './notifications.service';
import { PrismaService } from '../db/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const prisma = {
    asignacionSupervisor: { findUnique: jest.fn() },
    usuario: { findMany: jest.fn() },
    notificacion: {
      createMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };

  const operadorId = '11111111-1111-1111-1111-111111111111';
  const eventoId = '22222222-2222-2222-2222-222222222222';
  const supervisorId = '55555555-5555-5555-5555-555555555555';
  const adminId = '99999999-9999-9999-9999-999999999999';

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr));
    const moduleRef = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  describe('encolar* (supervisor + admins)', () => {
    it('encola PUSH y EMAIL para el supervisor y cada administrador', async () => {
      prisma.asignacionSupervisor.findUnique.mockResolvedValueOnce({ supervisorId });
      prisma.usuario.findMany.mockResolvedValueOnce([{ id: adminId }]);

      await service.encolarSalidaDpi({ operadorId, eventoId, payload: { foo: 'bar' } });

      expect(prisma.notificacion.createMany).toHaveBeenCalledTimes(1);
      const filas = prisma.notificacion.createMany.mock.calls[0][0].data;
      // 2 destinatarios (supervisor + admin) x 2 canales (PUSH/EMAIL) = 4 filas
      expect(filas).toHaveLength(4);
      expect(filas.every((f: any) => f.tipoEvento === 'SALIDA_DPI')).toBe(true);
      expect(filas.filter((f: any) => f.canal === 'PUSH')).toHaveLength(2);
      expect(filas.filter((f: any) => f.canal === 'EMAIL')).toHaveLength(2);
    });

    it('deduplica si el supervisor también es administrador', async () => {
      prisma.asignacionSupervisor.findUnique.mockResolvedValueOnce({ supervisorId: adminId });
      prisma.usuario.findMany.mockResolvedValueOnce([{ id: adminId }]);

      await service.encolarLlegadaDpi({ operadorId, eventoId, payload: {} });

      const filas = prisma.notificacion.createMany.mock.calls[0][0].data;
      expect(filas).toHaveLength(2); // un solo destinatario x 2 canales
    });

    it('no encola nada si no hay supervisor ni administradores', async () => {
      prisma.asignacionSupervisor.findUnique.mockResolvedValueOnce(null);
      prisma.usuario.findMany.mockResolvedValueOnce([]);

      await service.encolarIncidencia({ operadorId, eventoId, payload: {} });

      expect(prisma.notificacion.createMany).not.toHaveBeenCalled();
    });
  });

  describe('listMine', () => {
    it('devuelve items mapeados con total y noLeidas', async () => {
      prisma.notificacion.count
        .mockResolvedValueOnce(1) // total
        .mockResolvedValueOnce(1); // noLeidas
      prisma.notificacion.findMany.mockResolvedValueOnce([
        {
          id: 'n1',
          tipoEvento: 'SALIDA_DPI',
          canal: 'PUSH',
          payload: { foo: 'bar' },
          creadoEn: new Date('2026-06-19T10:00:00Z'),
          leidaEn: null,
        },
      ]);

      const result = await service.listMine({ usuarioId: supervisorId });

      expect(result.total).toBe(1);
      expect(result.noLeidas).toBe(1);
      expect(result.items[0].id).toBe('n1');
      expect(result.items[0].leidaEn).toBeNull();
    });

    it('filtra solo no leídas cuando soloNoLeidas=true', async () => {
      prisma.notificacion.count.mockResolvedValue(0);
      prisma.notificacion.findMany.mockResolvedValueOnce([]);

      await service.listMine({ usuarioId: supervisorId, soloNoLeidas: true });

      expect(prisma.notificacion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { usuarioId: supervisorId, canal: 'PUSH', leidaEn: null },
        }),
      );
    });
  });

  describe('markRead', () => {
    it('lanza NotFoundException si la notificación no existe', async () => {
      prisma.notificacion.findUnique.mockResolvedValueOnce(null);
      await expect(service.markRead('n1', supervisorId)).rejects.toThrow(NotFoundException);
    });

    it('lanza ForbiddenException si la notificación es de otro usuario', async () => {
      prisma.notificacion.findUnique.mockResolvedValueOnce({
        id: 'n1',
        usuarioId: 'otro-usuario',
        leidaEn: null,
      });
      await expect(service.markRead('n1', supervisorId)).rejects.toThrow(ForbiddenException);
      expect(prisma.notificacion.update).not.toHaveBeenCalled();
    });

    it('no actualiza si la notificación ya estaba leída', async () => {
      prisma.notificacion.findUnique.mockResolvedValueOnce({
        id: 'n1',
        usuarioId: supervisorId,
        leidaEn: new Date('2026-06-19T09:00:00Z'),
      });
      await service.markRead('n1', supervisorId);
      expect(prisma.notificacion.update).not.toHaveBeenCalled();
    });

    it('marca la notificación como leída', async () => {
      prisma.notificacion.findUnique.mockResolvedValueOnce({
        id: 'n1',
        usuarioId: supervisorId,
        leidaEn: null,
      });
      await service.markRead('n1', supervisorId);
      expect(prisma.notificacion.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { leidaEn: expect.any(Date) },
      });
    });
  });
});
