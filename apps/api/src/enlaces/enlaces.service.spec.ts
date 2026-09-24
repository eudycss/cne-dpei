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

    it('SÍ notifica en la primera carga de un enlace ya FALLO (sin estado anterior) — evita quedar mudo si ya estaba caído', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(null);
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      await service.revisarEnlaces();

      expect(telegram.enviarEnlaceCaido).toHaveBeenCalledWith('978', 'Escuela Central');
      expect(notifications.encolarEnlaceCaido).toHaveBeenCalledWith({
        codigoRecinto: '978',
        nombreRecinto: 'Escuela Central',
      });
      expect(sendEnlaceCaido).toHaveBeenCalledWith(
        ['a@b.com'],
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }],
      );
    });

    it('vuelve a notificar en una caída posterior a una recuperación (null→FALLO→ACTIVO→FALLO)', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });
      const fila = { codigoRecinto: '978', nombreRecinto: 'Escuela Central' };

      // Ciclo 1: primera vez que se ve, ya llega en FALLO → notifica.
      sheetsClient.leerEnlacesImbabura.mockResolvedValueOnce([{ ...fila, estado: 'FALLO' }]);
      prisma.enlaceRecinto.findUnique.mockResolvedValueOnce(null);
      await service.revisarEnlaces();
      expect(telegram.enviarEnlaceCaido).toHaveBeenCalledTimes(1);

      // Ciclo 2: se recupera a ACTIVO → no notifica.
      sheetsClient.leerEnlacesImbabura.mockResolvedValueOnce([{ ...fila, estado: 'ACTIVO' }]);
      prisma.enlaceRecinto.findUnique.mockResolvedValueOnce({ estado: 'FALLO' });
      await service.revisarEnlaces();
      expect(telegram.enviarEnlaceCaido).toHaveBeenCalledTimes(1);

      // Ciclo 3: vuelve a caer (ACTIVO→FALLO) → notifica de nuevo.
      sheetsClient.leerEnlacesImbabura.mockResolvedValueOnce([{ ...fila, estado: 'FALLO' }]);
      prisma.enlaceRecinto.findUnique.mockResolvedValueOnce({ estado: 'ACTIVO' });
      await service.revisarEnlaces();
      expect(telegram.enviarEnlaceCaido).toHaveBeenCalledTimes(2);

      expect(sendEnlaceCaido).toHaveBeenCalledTimes(2);
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

    it('persiste el canton leido de la hoja (create y update)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: 'Cotacachi', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(null);

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ canton: 'Cotacachi' }),
          update: expect.objectContaining({ canton: 'Cotacachi' }),
        }),
      );
    });

    it('guarda canton null si la hoja no trae la columna (en vez de string vacio)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: '', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(null);

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ canton: null }),
        }),
      );
    });

    it('normaliza la capitalizacion del canton (COTACACHI y cotacachi guardan igual)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela A', canton: 'COTACACHI', estado: 'ACTIVO' },
        { codigoRecinto: '982', nombreRecinto: 'Escuela B', canton: 'san miguel de urcuquí', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(null);

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.upsert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ create: expect.objectContaining({ canton: 'Cotacachi' }) }),
      );
      expect(prisma.enlaceRecinto.upsert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ create: expect.objectContaining({ canton: 'San Miguel De Urcuquí' }) }),
      );
    });

    it('un error al procesar una fila no interrumpe el resto del ciclo ni las notificaciones ya acumuladas', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Rota', estado: 'FALLO' },
        { codigoRecinto: '982', nombreRecinto: 'Escuela Sana', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValueOnce(null);
      prisma.enlaceRecinto.upsert.mockRejectedValueOnce(new Error('violates constraint'));
      prisma.enlaceRecinto.findUnique.mockResolvedValueOnce(null);
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      await expect(service.revisarEnlaces()).resolves.toBeUndefined();

      expect(telegram.enviarEnlaceCaido).toHaveBeenCalledTimes(1);
      expect(telegram.enviarEnlaceCaido).toHaveBeenCalledWith('982', 'Escuela Sana');
      expect(sendEnlaceCaido).toHaveBeenCalledWith(
        ['a@b.com'],
        [{ codigoRecinto: '982', nombreRecinto: 'Escuela Sana' }],
      );
    });
  });

  describe('list', () => {
    it('devuelve el canton de cada recinto', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        {
          codigoRecinto: '978',
          nombreRecinto: 'Escuela Central',
          canton: 'Cotacachi',
          estado: 'ACTIVO',
          actualizadoEn: new Date('2026-09-23T11:00:00.000Z'),
        },
        {
          codigoRecinto: '982',
          nombreRecinto: 'Otra Escuela',
          canton: null,
          estado: 'FALLO',
          actualizadoEn: new Date('2026-09-23T11:00:00.000Z'),
        },
      ]);

      const result = await service.list();

      expect(result[0].canton).toBe('Cotacachi');
      expect(result[1].canton).toBe('');
    });
  });

  describe('config de correos', () => {
    beforeEach(() => {
      // Por defecto, sin recintos caídos, para que los tests de esta sección
      // que no ejercitan el catch-up no dependan del estado que haya dejado
      // otro describe (ej. 'list') en prisma.enlaceRecinto.findMany.
      prisma.enlaceRecinto.findMany.mockResolvedValue([]);
    });

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

    it('agrega un correo nuevo con recintos en FALLO y envía el catch-up solo a ese correo', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ id: 1, correos: ['a@b.com'] });
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: ['a@b.com', 'nuevo@x.com'] });
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
        { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', estado: 'FALLO' },
      ]);

      await service.addCorreo('nuevo@x.com');

      expect(prisma.enlaceRecinto.findMany).toHaveBeenCalledWith({ where: { estado: 'FALLO' } });
      expect(sendEnlaceCaido).toHaveBeenCalledTimes(1);
      expect(sendEnlaceCaido).toHaveBeenCalledWith(
        ['nuevo@x.com'],
        [
          { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
          { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide' },
        ],
      );
    });

    it('agrega un correo nuevo sin recintos en FALLO y no envía ningún catch-up', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ id: 1, correos: ['a@b.com'] });
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: ['a@b.com', 'nuevo@x.com'] });
      prisma.enlaceRecinto.findMany.mockResolvedValue([]);

      await service.addCorreo('nuevo@x.com');

      expect(sendEnlaceCaido).not.toHaveBeenCalled();
    });

    it('agrega un correo que ya existía y no reenvía el catch-up (dedup)', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ id: 1, correos: ['a@b.com'] });
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: ['a@b.com'] });

      await service.addCorreo('a@b.com');

      expect(prisma.enlaceRecinto.findMany).not.toHaveBeenCalled();
      expect(sendEnlaceCaido).not.toHaveBeenCalled();
    });

    it('un fallo en el envío del catch-up no impide que addCorreo persista el correo ni devuelva éxito', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ id: 1, correos: ['a@b.com'] });
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: ['a@b.com', 'nuevo@x.com'] });
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      sendEnlaceCaido.mockRejectedValueOnce(new Error('Brevo caído'));

      const result = await service.addCorreo('nuevo@x.com');

      expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ correos: ['a@b.com', 'nuevo@x.com'] }) }),
      );
      expect(result.correos).toEqual(['a@b.com', 'nuevo@x.com']);
    });

    it('un fallo al consultar los recintos caídos para el catch-up no impide que addCorreo persista el correo ni devuelva éxito', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ id: 1, correos: ['a@b.com'] });
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: ['a@b.com', 'nuevo@x.com'] });
      prisma.enlaceRecinto.findMany.mockRejectedValueOnce(new Error('timeout de base de datos'));

      const result = await service.addCorreo('nuevo@x.com');

      expect(sendEnlaceCaido).not.toHaveBeenCalled();
      expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ correos: ['a@b.com', 'nuevo@x.com'] }) }),
      );
      expect(result.correos).toEqual(['a@b.com', 'nuevo@x.com']);
    });
  });
});
