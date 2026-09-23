import { Test } from '@nestjs/testing';
import { EnlacesService } from './enlaces.service';
import { PrismaService } from '../db/prisma.service';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import { TelegramNotifier } from './telegram-notifier';
import { NotificationsService } from '../notifications/notifications.service';

const sendEnlaceCaido = jest.fn().mockResolvedValue(undefined);

jest.mock('../auth/notifier', () => ({
  resolveNotifier: () => ({ sendEnlaceCaido }),
}));

describe('EnlacesService', () => {
  let service: EnlacesService;

  const prisma = {
    enlaceRecinto: { findUnique: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
    configEnlaces: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const sheetsClient = { leerEnlacesImbabura: jest.fn() };
  const telegram = { enviarEnlaceCaido: jest.fn().mockResolvedValue(undefined) };
  const notifications = { encolarEnlaceCaido: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnlacesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SheetsEnlacesClient, useValue: sheetsClient },
        { provide: TelegramNotifier, useValue: telegram },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(EnlacesService);
  });

  describe('revisarEnlaces', () => {
    it('notifica cuando un enlace pasa de ACTIVO a FALLO', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ codigoRecinto: '978', estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.upsert).toHaveBeenCalledTimes(1);
      expect(telegram.enviarEnlaceCaido).toHaveBeenCalledWith('978', 'Escuela Central');
      expect(notifications.encolarEnlaceCaido).toHaveBeenCalledWith({
        codigoRecinto: '978',
        nombreRecinto: 'Escuela Central',
      });
      expect(sendEnlaceCaido).toHaveBeenCalledTimes(1);
      expect(sendEnlaceCaido).toHaveBeenCalledWith(
        ['a@b.com'],
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }],
      );
    });

    it('agrupa todas las caídas del mismo ciclo en un solo correo', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
        { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      await service.revisarEnlaces();

      expect(sendEnlaceCaido).toHaveBeenCalledTimes(1);
      expect(sendEnlaceCaido).toHaveBeenCalledWith(
        ['a@b.com'],
        [
          { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
          { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide' },
        ],
      );
    });

    it('un fallo en el envío del correo batcheado no interrumpe el ciclo ni relanza', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });
      sendEnlaceCaido.mockRejectedValueOnce(new Error('Brevo caído'));

      await expect(service.revisarEnlaces()).resolves.toBeUndefined();
      expect(telegram.enviarEnlaceCaido).toHaveBeenCalled();
      expect(notifications.encolarEnlaceCaido).toHaveBeenCalled();
    });

    it('no envía correo si nadie está registrado, aunque sí notifica Telegram e in-app', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });

      await service.revisarEnlaces();

      expect(sendEnlaceCaido).not.toHaveBeenCalled();
      expect(telegram.enviarEnlaceCaido).toHaveBeenCalledWith('978', 'Escuela Central');
    });

    it('NO notifica si el enlace sigue FALLO (ya estaba caído)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ codigoRecinto: '978', estado: 'FALLO' });

      await service.revisarEnlaces();

      expect(telegram.enviarEnlaceCaido).not.toHaveBeenCalled();
      expect(notifications.encolarEnlaceCaido).not.toHaveBeenCalled();
    });

    it('NO notifica en la primera carga de un enlace ya FALLO (sin estado anterior)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(null);

      await service.revisarEnlaces();

      expect(telegram.enviarEnlaceCaido).not.toHaveBeenCalled();
      expect(notifications.encolarEnlaceCaido).not.toHaveBeenCalled();
    });

    it('si falla la lectura de la hoja, no toca la tabla ni notifica', async () => {
      sheetsClient.leerEnlacesImbabura.mockRejectedValue(new Error('cuota excedida'));

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.upsert).not.toHaveBeenCalled();
      expect(telegram.enviarEnlaceCaido).not.toHaveBeenCalled();
    });

    it('un fallo en Telegram no impide encolar el aviso in-app', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ codigoRecinto: '978', estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      telegram.enviarEnlaceCaido.mockRejectedValueOnce(new Error('telegram caído'));

      await service.revisarEnlaces();

      expect(notifications.encolarEnlaceCaido).toHaveBeenCalled();
    });
  });

  describe('config de correos', () => {
    it('addCorreo agrega un correo sin duplicar', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ id: 1, correos: ['a@b.com'] });
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: ['a@b.com', 'c@d.com'] });

      const result = await service.addCorreo('c@d.com');

      expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ correos: ['a@b.com', 'c@d.com'] }),
          update: expect.objectContaining({ correos: ['a@b.com', 'c@d.com'] }),
        }),
      );
      expect(result.correos).toEqual(['a@b.com', 'c@d.com']);
    });

    it('removeCorreo quita un correo existente', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ id: 1, correos: ['a@b.com', 'c@d.com'] });
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: ['c@d.com'] });

      const result = await service.removeCorreo('a@b.com');

      expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ correos: ['c@d.com'] }) }),
      );
      expect(result.correos).toEqual(['c@d.com']);
    });

    it('addCorreo normaliza mayúsculas/espacios para no duplicar el mismo correo', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ id: 1, correos: ['a@b.com'] });
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: ['a@b.com'] });

      await service.addCorreo('  A@B.com  ');

      expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ correos: ['a@b.com'] }) }),
      );
    });

    it('removeCorreo normaliza mayúsculas/espacios al comparar', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ id: 1, correos: ['a@b.com'] });
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: [] });

      await service.removeCorreo('A@B.com');

      expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ correos: [] }) }),
      );
    });
  });
});
