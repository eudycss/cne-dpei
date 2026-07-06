import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { TrackingService } from './tracking.service';
import { PrismaService } from '../db/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { AlertasService } from '../alertas/alertas.service';

describe('TrackingService', () => {
  let service: TrackingService;

  const prisma = {
    eventoElectoral: { findFirst: jest.fn() },
    kitElectoral: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    recinto: { findUnique: jest.fn(), findMany: jest.fn() },
    configAlerta: { findUnique: jest.fn() },
    militar: { findFirst: jest.fn() },
    eventoTracking: { findFirst: jest.fn(), findMany: jest.fn() },
    recepcionKit: { findFirst: jest.fn(), findMany: jest.fn() },
    recepcionDpiKit: { findFirst: jest.fn(), create: jest.fn() },
    usuario: { findUnique: jest.fn(), findMany: jest.fn() },
    asignacionSupervisor: { findFirst: jest.fn(), findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };

  const notifications = {
    encolarSalidaDpi: jest.fn(),
    encolarLlegadaRecinto: jest.fn(),
    encolarSalidaRecinto: jest.fn(),
    encolarLlegadaDpi: jest.fn(),
  };

  const storage = {
    saveEncrypted: jest.fn(),
    exists: jest.fn(),
    readDecrypted: jest.fn(),
  };

  const alertas = {
    generarKitNoCorresponde: jest.fn(),
  };

  const eventoId = '22222222-2222-2222-2222-222222222222';
  const operadorId = '11111111-1111-1111-1111-111111111111';
  const recintoId = '44444444-4444-4444-4444-444444444444';
  const kitId = '33333333-3333-3333-3333-333333333333';
  const ocurridoEn = '2026-06-23T10:00:00.000Z';
  const geo = { latitud: 0.35, longitud: -78.11, ocurridoEn };

  const evento = { id: eventoId, nombre: 'Evento Test', estado: 'ACTIVO' };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr));

    const moduleRef = await Test.createTestingModule({
      providers: [
        TrackingService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: StorageService, useValue: storage },
        { provide: AlertasService, useValue: alertas },
      ],
    }).compile();

    service = moduleRef.get(TrackingService);
  });

  describe('miAsignacion', () => {
    it('lanza NotFoundException si no hay evento activo', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      await expect(service.miAsignacion(operadorId)).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si el operador no tiene kits', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      await expect(service.miAsignacion(operadorId)).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si los kits no tienen recinto asignado', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: kitId, recintoId: null }]);
      await expect(service.miAsignacion(operadorId)).rejects.toThrow(NotFoundException);
    });

    it('lanza ConflictException si los kits apuntan a varios recintos', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        { id: kitId, recintoId },
        { id: 'k2', recintoId: '55555555-5555-5555-5555-555555555555' },
      ]);
      await expect(service.miAsignacion(operadorId)).rejects.toThrow(ConflictException);
    });
  });

  describe('registrarSalidaDpi', () => {
    it('lanza NotFoundException si no hay evento activo', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      await expect(service.registrarSalidaDpi(operadorId, geo as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza ConflictException si ya registró la salida del DPI', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce({ id: 'tk1' });
      await expect(service.registrarSalidaDpi(operadorId, geo as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('registra la salida e encola la notificación', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce(null); // sin salida previa
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'new-tracking-id' }]);
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'CDA 1' });

      const result = await service.registrarSalidaDpi(operadorId, geo as any);

      expect(result.id).toBe('new-tracking-id');
      expect(notifications.encolarSalidaDpi).toHaveBeenCalledTimes(1);
    });
  });

  describe('validarKit', () => {
    it('lanza NotFoundException si el kit no existe en el evento activo', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.validarKit(operadorId, 'ABCD2345')).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si el kit no le pertenece al operador', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({ id: kitId, operadorId: 'otro' });
      await expect(service.validarKit(operadorId, 'ABCD2345')).rejects.toThrow(BadRequestException);
    });

    it('devuelve el kit con yaRecibido=true si ya hay recepción', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({
        id: kitId,
        operadorId,
        codigoUnico: 'ABCD2345',
        nombre: 'Kit 1',
        contenidos: null,
      });
      prisma.recepcionKit.findFirst.mockResolvedValueOnce({ id: 'rk1' });

      const result = await service.validarKit(operadorId, 'ABCD2345');

      expect(result.yaRecibido).toBe(true);
      expect(result.id).toBe(kitId);
    });
  });

  describe('confirmarRecepcionKit', () => {
    const input = { kitId, fotoMilitarUrl: 'militares/foto.enc', latitud: 0.35, longitud: -78.11 };

    it('lanza NotFoundException si el kit no existe', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.confirmarRecepcionKit(operadorId, input as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza BadRequestException si el kit no le pertenece', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({ id: kitId, operadorId: 'otro' });
      await expect(service.confirmarRecepcionKit(operadorId, input as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si la foto del militar no existe en storage', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({ id: kitId, operadorId });
      storage.exists.mockResolvedValueOnce(false);
      await expect(service.confirmarRecepcionKit(operadorId, input as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('es idempotente: devuelve la recepción existente sin insertar de nuevo', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({ id: kitId, operadorId });
      storage.exists.mockResolvedValueOnce(true);
      prisma.recepcionKit.findFirst.mockResolvedValueOnce({
        id: 'rk-existente',
        confirmadoEn: new Date('2026-06-23T09:00:00Z'),
      });

      const result = await service.confirmarRecepcionKit(operadorId, input as any);

      expect(result.id).toBe('rk-existente');
      expect(prisma.$queryRaw).not.toHaveBeenCalled(); // no inserta
    });
  });

  describe('registrarLlegadaRecinto', () => {
    it('lanza ConflictException si ya registró la llegada', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce({ id: 'tk1' }); // llegada previa
      await expect(service.registrarLlegadaRecinto(operadorId, geo as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('lanza BadRequestException si no registró la salida del DPI antes', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin llegada previa
        .mockResolvedValueOnce(null); // sin salida_dpi
      await expect(service.registrarLlegadaRecinto(operadorId, geo as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si faltan kits por confirmar', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin llegada previa
        .mockResolvedValueOnce({ id: 'salida' }); // salida_dpi ok
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        { id: 'k1', recintoId },
        { id: 'k2', recintoId },
      ]);
      prisma.recepcionKit.findMany.mockResolvedValueOnce([{ kitId: 'k1' }]); // falta k2
      await expect(service.registrarLlegadaRecinto(operadorId, geo as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si está fuera del margen del recinto (geocerca)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'salida' });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: 'k1', recintoId }]);
      prisma.recepcionKit.findMany.mockResolvedValueOnce([{ kitId: 'k1' }]); // todo recibido
      prisma.$queryRaw.mockResolvedValueOnce([{ metros: 9999 }]); // lejos
      prisma.configAlerta.findUnique.mockResolvedValueOnce(null); // margen default 150

      await expect(service.registrarLlegadaRecinto(operadorId, geo as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('registrarSalidaRecinto', () => {
    it('lanza ConflictException si ya registró la salida del recinto', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce({ id: 'tk1' });
      await expect(service.registrarSalidaRecinto(operadorId, geo as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('lanza BadRequestException si no registró la llegada al recinto antes', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin salida previa
        .mockResolvedValueOnce(null); // sin llegada al recinto
      await expect(service.registrarSalidaRecinto(operadorId, geo as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('registrarLlegadaDpi', () => {
    it('lanza ConflictException si ya registró la llegada al DPI', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce({ id: 'tk1' });
      await expect(service.registrarLlegadaDpi(operadorId, geo as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('lanza BadRequestException si no registró la salida del recinto antes', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin llegada dpi previa
        .mockResolvedValueOnce(null); // sin salida del recinto
      await expect(service.registrarLlegadaDpi(operadorId, geo as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('registra la llegada, marca kits como RETORNADO y notifica', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin llegada dpi previa
        .mockResolvedValueOnce({ id: 'salida-recinto' }); // salida del recinto ok
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'llegada-dpi-id' }]);
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'CDA 1' });

      const result = await service.registrarLlegadaDpi(operadorId, geo as any);

      expect(result.id).toBe('llegada-dpi-id');
      expect(prisma.kitElectoral.updateMany).toHaveBeenCalledWith({
        where: { eventoId, operadorId, estado: 'EN_RETORNO' },
        data: { estado: 'RETORNADO' },
      });
      expect(notifications.encolarLlegadaDpi).toHaveBeenCalledTimes(1);
    });
  });

  describe('ingestarPosiciones', () => {
    const input = {
      posiciones: [{ latitud: 0.35, longitud: -78.11, capturadoEn: ocurridoEn }],
    };

    it('lanza BadRequestException si aún no registró la salida del recinto', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // salida_recinto
        .mockResolvedValueOnce(null); // llegada_dpi
      await expect(service.ingestarPosiciones(operadorId, input as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si ya registró la llegada al DPI (rastreo terminó)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce({ id: 'salida' }) // salida_recinto ok
        .mockResolvedValueOnce({ id: 'llegada' }); // llegada_dpi -> termino
      await expect(service.ingestarPosiciones(operadorId, input as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('inserta las posiciones y devuelve el conteo recibido', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce({ id: 'salida' }) // salida_recinto ok
        .mockResolvedValueOnce(null); // sin llegada_dpi
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.ingestarPosiciones(operadorId, input as any);

      expect(result.recibidas).toBe(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });
});
