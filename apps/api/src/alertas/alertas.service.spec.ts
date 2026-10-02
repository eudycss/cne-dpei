import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AlertasService } from './alertas.service';
import { PrismaService } from '../db/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('AlertasService — visibilidad por técnico asignado', () => {
  let service: AlertasService;

  const eventoId = '11111111-1111-1111-1111-111111111111';
  const tecnicoId = '22222222-2222-2222-2222-222222222222';
  const operadorPropio = '33333333-3333-3333-3333-333333333333';
  const alertaId = '44444444-4444-4444-4444-444444444444';
  const kitPropio = '55555555-5555-5555-5555-555555555555';

  const prisma = {
    alerta: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    asignacionSupervisor: { findMany: jest.fn() },
    kitElectoral: { findMany: jest.fn() },
    usuario: { findMany: jest.fn() },
  };

  const filaAlerta = (over: Record<string, unknown> = {}) => ({
    id: alertaId,
    eventoId,
    operadorId: operadorPropio,
    kitId: null,
    tipo: 'SIN_SINCRONIZAR',
    mensaje: 'x',
    estado: 'GENERADA',
    generadaEn: new Date('2026-09-30T12:00:00Z'),
    ...over,
  });

  const filtroEsperado = (kitIds: string[]) => ({
    OR: [
      { operadorId: { in: [operadorPropio] } },
      ...(kitIds.length ? [{ tipo: 'KIT_NO_CORRESPONDE', kitId: { in: kitIds } }] : []),
    ],
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.usuario.findMany.mockResolvedValue([]);
    prisma.asignacionSupervisor.findMany.mockResolvedValue([{ operadorId: operadorPropio }]);
    prisma.kitElectoral.findMany.mockResolvedValue([{ id: kitPropio }]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AlertasService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { encolarAlerta: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AlertasService);
  });

  describe('list', () => {
    it('el administrador ve todas las alertas del evento (sin consultar asignaciones)', async () => {
      prisma.alerta.findMany.mockResolvedValueOnce([filaAlerta()]);

      const res = await service.list({ viewerId: 'admin', roles: ['ADMINISTRADOR'], eventoId });

      expect(res).toHaveLength(1);
      expect(prisma.asignacionSupervisor.findMany).not.toHaveBeenCalled();
      expect(prisma.alerta.findMany.mock.calls[0][0].where).toEqual({ eventoId });
    });

    it('el técnico ve las alertas de sus operadores y los "kit no corresponde" de sus kits', async () => {
      prisma.alerta.findMany.mockResolvedValueOnce([filaAlerta()]);

      await service.list({
        viewerId: tecnicoId,
        roles: ['TECNICO_SUPERVISOR'],
        eventoId,
        estado: 'GENERADA',
      });

      expect(prisma.asignacionSupervisor.findMany).toHaveBeenCalledWith({
        where: { eventoId, supervisorId: tecnicoId },
        select: { operadorId: true },
      });
      expect(prisma.kitElectoral.findMany).toHaveBeenCalledWith({
        where: { eventoId, operadorId: { in: [operadorPropio] } },
        select: { id: true },
      });
      expect(prisma.alerta.findMany.mock.calls[0][0].where).toEqual({
        eventoId,
        estado: 'GENERADA',
        AND: [filtroEsperado([kitPropio])],
      });
    });

    it('los filtros tipo/estado se combinan en AND con la visibilidad (no la amplían)', async () => {
      prisma.alerta.findMany.mockResolvedValueOnce([]);

      await service.list({
        viewerId: tecnicoId,
        roles: ['TECNICO_SUPERVISOR'],
        eventoId,
        tipo: 'KIT_NO_CORRESPONDE',
        estado: 'VISTA',
      });

      expect(prisma.alerta.findMany.mock.calls[0][0].where).toEqual({
        eventoId,
        tipo: 'KIT_NO_CORRESPONDE',
        estado: 'VISTA',
        AND: [filtroEsperado([kitPropio])],
      });
    });

    it('si sus operadores no tienen kits, solo filtra por operador', async () => {
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.alerta.findMany.mockResolvedValueOnce([]);

      await service.list({ viewerId: tecnicoId, roles: ['TECNICO_SUPERVISOR'], eventoId });

      expect(prisma.alerta.findMany.mock.calls[0][0].where).toEqual({ eventoId, AND: [filtroEsperado([])] });
    });

    it('el técnico sin operadores asignados no ve ninguna alerta', async () => {
      prisma.asignacionSupervisor.findMany.mockResolvedValueOnce([]);

      const res = await service.list({ viewerId: tecnicoId, roles: ['TECNICO_SUPERVISOR'], eventoId });

      expect(res).toEqual([]);
      expect(prisma.alerta.findMany).not.toHaveBeenCalled();
    });
  });

  describe('updateEstado', () => {
    it('el técnico puede marcar una alerta visible para él (mismo filtro que list)', async () => {
      prisma.alerta.findUnique.mockResolvedValueOnce(filaAlerta());
      prisma.alerta.findFirst.mockResolvedValueOnce({ id: alertaId });
      prisma.alerta.update.mockResolvedValueOnce(filaAlerta({ estado: 'VISTA' }));

      const res = await service.updateEstado(alertaId, tecnicoId, ['TECNICO_SUPERVISOR'], {
        estado: 'VISTA',
      });

      expect(res.estado).toBe('VISTA');
      expect(prisma.alerta.findFirst).toHaveBeenCalledWith({
        where: { id: alertaId, ...filtroEsperado([kitPropio]) },
        select: { id: true },
      });
    });

    it('el técnico del operador dueño del kit puede atender un "kit no corresponde"', async () => {
      prisma.alerta.findUnique.mockResolvedValueOnce(
        filaAlerta({ operadorId: 'otro-operador', tipo: 'KIT_NO_CORRESPONDE', kitId: kitPropio }),
      );
      prisma.alerta.findFirst.mockResolvedValueOnce({ id: alertaId });
      prisma.alerta.update.mockResolvedValueOnce(filaAlerta({ estado: 'ATENDIDA' }));
      const otroEvento = '66666666-6666-6666-6666-666666666666';
      prisma.alerta.findUnique.mockReset();
      prisma.alerta.findUnique.mockResolvedValueOnce(
        filaAlerta({ eventoId: otroEvento, operadorId: 'otro-operador', tipo: 'KIT_NO_CORRESPONDE', kitId: kitPropio }),
      );

      await service.updateEstado(alertaId, tecnicoId, ['TECNICO_SUPERVISOR'], { estado: 'ATENDIDA' });

      expect(prisma.alerta.update).toHaveBeenCalled();
      // La visibilidad se calcula en el evento de la alerta, no en otro.
      expect(prisma.asignacionSupervisor.findMany).toHaveBeenCalledWith({
        where: { eventoId: otroEvento, supervisorId: tecnicoId },
        select: { operadorId: true },
      });
    });

    it('el técnico recibe 404 al tocar una alerta que no le corresponde (y no se modifica)', async () => {
      prisma.alerta.findUnique.mockResolvedValueOnce(filaAlerta({ operadorId: 'ajeno' }));
      prisma.alerta.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.updateEstado(alertaId, tecnicoId, ['TECNICO_SUPERVISOR'], { estado: 'ATENDIDA' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.alerta.update).not.toHaveBeenCalled();
    });

    it('el técnico sin operadores en ese evento recibe 404', async () => {
      prisma.alerta.findUnique.mockResolvedValueOnce(filaAlerta());
      prisma.asignacionSupervisor.findMany.mockResolvedValueOnce([]);

      await expect(
        service.updateEstado(alertaId, tecnicoId, ['TECNICO_SUPERVISOR'], { estado: 'VISTA' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.alerta.findFirst).not.toHaveBeenCalled();
      expect(prisma.alerta.update).not.toHaveBeenCalled();
    });

    it('el administrador puede marcar cualquier alerta sin consultar asignaciones', async () => {
      prisma.alerta.findUnique.mockResolvedValueOnce(filaAlerta({ operadorId: 'ajeno' }));
      prisma.alerta.update.mockResolvedValueOnce(filaAlerta({ estado: 'ATENDIDA' }));

      await service.updateEstado(alertaId, 'admin', ['ADMINISTRADOR'], { estado: 'ATENDIDA' });

      expect(prisma.asignacionSupervisor.findMany).not.toHaveBeenCalled();
      expect(prisma.alerta.update).toHaveBeenCalled();
    });
  });
});
