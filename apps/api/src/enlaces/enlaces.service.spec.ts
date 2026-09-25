import { Test } from '@nestjs/testing';
import { EnlacesService } from './enlaces.service';
import { PrismaService } from '../db/prisma.service';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import { TelegramNotifier, TEXTO_BOTON_CAIDOS } from './telegram-notifier';
import { NotificationsService } from '../notifications/notifications.service';

const sendEnlaceCaido = jest.fn().mockResolvedValue(undefined);
const sendEnlaceRecuperado = jest.fn().mockResolvedValue(undefined);

jest.mock('../auth/notifier', () => ({
  resolveNotifier: () => ({ sendEnlaceCaido, sendEnlaceRecuperado }),
}));

describe('EnlacesService', () => {
  let service: EnlacesService;

  const prisma = {
    enlaceRecinto: { findUnique: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
    configEnlaces: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const sheetsClient = { leerEnlacesImbabura: jest.fn() };
  const telegram = {
    enviarListaActual: jest.fn().mockResolvedValue(undefined),
    enviarRecuperados: jest.fn().mockResolvedValue(undefined),
  };
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
      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }],
        new Set(['978']),
      );
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
      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [
          { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
          { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide' },
        ],
        new Set(['978', '982']),
      );
    });

    it('incluye recintos ya caídos de ciclos anteriores (sin 🆕) junto con el que recién cae (con 🆕) — el caso que motivó este mensaje agrupado', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '111', nombreRecinto: 'Ya caído', estado: 'FALLO' },
        { codigoRecinto: '222', nombreRecinto: 'Recién cae', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique
        .mockResolvedValueOnce({ estado: 'FALLO' }) // 111 ya estaba caído
        .mockResolvedValueOnce({ estado: 'ACTIVO' }); // 222 acaba de caer
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });

      await service.revisarEnlaces();

      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [
          { codigoRecinto: '111', nombreRecinto: 'Ya caído' },
          { codigoRecinto: '222', nombreRecinto: 'Recién cae' },
        ],
        new Set(['222']),
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
      expect(telegram.enviarListaActual).toHaveBeenCalled();
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
      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }],
        new Set(['978']),
      );
    });

    it('NO notifica si el enlace sigue FALLO (ya estaba caído)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ codigoRecinto: '978', estado: 'FALLO' });

      await service.revisarEnlaces();

      expect(telegram.enviarListaActual).not.toHaveBeenCalled();
      expect(notifications.encolarEnlaceCaido).not.toHaveBeenCalled();
    });

    it('SÍ notifica en la primera carga de un enlace ya FALLO (sin estado anterior) — evita quedar mudo si ya estaba caído', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(null);
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      await service.revisarEnlaces();

      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }],
        new Set(['978']),
      );
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
      expect(telegram.enviarListaActual).toHaveBeenCalledTimes(1);

      // Ciclo 2: se recupera a ACTIVO → no notifica.
      sheetsClient.leerEnlacesImbabura.mockResolvedValueOnce([{ ...fila, estado: 'ACTIVO' }]);
      prisma.enlaceRecinto.findUnique.mockResolvedValueOnce({ estado: 'FALLO' });
      await service.revisarEnlaces();
      expect(telegram.enviarListaActual).toHaveBeenCalledTimes(1);

      // Ciclo 3: vuelve a caer (ACTIVO→FALLO) → notifica de nuevo.
      sheetsClient.leerEnlacesImbabura.mockResolvedValueOnce([{ ...fila, estado: 'FALLO' }]);
      prisma.enlaceRecinto.findUnique.mockResolvedValueOnce({ estado: 'ACTIVO' });
      await service.revisarEnlaces();
      expect(telegram.enviarListaActual).toHaveBeenCalledTimes(2);

      expect(sendEnlaceCaido).toHaveBeenCalledTimes(2);
    });

    it('si falla la lectura de la hoja, no toca la tabla ni notifica', async () => {
      sheetsClient.leerEnlacesImbabura.mockRejectedValue(new Error('cuota excedida'));

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.upsert).not.toHaveBeenCalled();
      expect(telegram.enviarListaActual).not.toHaveBeenCalled();
    });

    it('un fallo en Telegram no impide encolar el aviso in-app', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ codigoRecinto: '978', estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      telegram.enviarListaActual.mockRejectedValueOnce(new Error('telegram caído'));

      await expect(service.revisarEnlaces()).resolves.toBeUndefined();

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

      expect(telegram.enviarListaActual).toHaveBeenCalledTimes(1);
      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [
          { codigoRecinto: '978', nombreRecinto: 'Escuela Rota' },
          { codigoRecinto: '982', nombreRecinto: 'Escuela Sana' },
        ],
        new Set(['982']),
      );
      expect(sendEnlaceCaido).toHaveBeenCalledWith(
        ['a@b.com'],
        [{ codigoRecinto: '982', nombreRecinto: 'Escuela Sana' }],
      );
    });

    it('notifica por correo y Telegram cuando un enlace pasa de FALLO a ACTIVO', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ codigoRecinto: '978', estado: 'FALLO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      await service.revisarEnlaces();

      expect(sendEnlaceRecuperado).toHaveBeenCalledWith(
        ['a@b.com'],
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }],
      );
      expect(telegram.enviarRecuperados).toHaveBeenCalledWith([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
      ]);
    });

    it('NO notifica recuperación si el enlace sigue ACTIVO (no venía de FALLO)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ codigoRecinto: '978', estado: 'ACTIVO' });

      await service.revisarEnlaces();

      expect(sendEnlaceRecuperado).not.toHaveBeenCalled();
      expect(telegram.enviarRecuperados).not.toHaveBeenCalled();
    });

    it('NO notifica recuperación en la primera carga de un enlace ya ACTIVO (sin estado anterior)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(null);

      await service.revisarEnlaces();

      expect(sendEnlaceRecuperado).not.toHaveBeenCalled();
      expect(telegram.enviarRecuperados).not.toHaveBeenCalled();
    });

    it('no envía correo de recuperación si nadie está registrado, aunque sí notifica Telegram', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'FALLO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });

      await service.revisarEnlaces();

      expect(sendEnlaceRecuperado).not.toHaveBeenCalled();
      expect(telegram.enviarRecuperados).toHaveBeenCalledWith([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
      ]);
    });

    it('un fallo en el correo o Telegram de recuperación no interrumpe el ciclo', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'FALLO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });
      sendEnlaceRecuperado.mockRejectedValueOnce(new Error('Brevo caído'));
      telegram.enviarRecuperados.mockRejectedValueOnce(new Error('telegram caído'));

      await expect(service.revisarEnlaces()).resolves.toBeUndefined();
    });

    it('agrupa caídas y recuperaciones del mismo ciclo en sus respectivas notificaciones', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '111', nombreRecinto: 'Se recupera', estado: 'ACTIVO' },
        { codigoRecinto: '222', nombreRecinto: 'Recién cae', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique
        .mockResolvedValueOnce({ estado: 'FALLO' }) // 111 se recupera
        .mockResolvedValueOnce({ estado: 'ACTIVO' }); // 222 acaba de caer
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      await service.revisarEnlaces();

      expect(sendEnlaceCaido).toHaveBeenCalledWith(
        ['a@b.com'],
        [{ codigoRecinto: '222', nombreRecinto: 'Recién cae' }],
      );
      expect(sendEnlaceRecuperado).toHaveBeenCalledWith(
        ['a@b.com'],
        [{ codigoRecinto: '111', nombreRecinto: 'Se recupera' }],
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

  describe('reenviarListaTelegram', () => {
    it('lee los recintos en FALLO y se los pasa al notifier de Telegram', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
        { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', estado: 'FALLO' },
      ]);

      const result = await service.reenviarListaTelegram();

      expect(prisma.enlaceRecinto.findMany).toHaveBeenCalledWith({ where: { estado: 'FALLO' } });
      expect(telegram.enviarListaActual).toHaveBeenCalledWith([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
        { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide' },
      ]);
      expect(result).toEqual({ enviados: 2 });
    });

    it('sin recintos en FALLO igual llama al notifier (avisa "sin caídos") y devuelve 0', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue([]);

      const result = await service.reenviarListaTelegram();

      expect(telegram.enviarListaActual).toHaveBeenCalledWith([]);
      expect(result).toEqual({ enviados: 0 });
    });
  });

  describe('procesarComandoTelegram', () => {
    afterEach(() => {
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      delete process.env.TELEGRAM_CHAT_ID;
    });

    it('responde con la lista de caídos cuando el secreto, el chat y el comando son correctos', async () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);

      await service.procesarComandoTelegram('secreto123', {
        message: { text: '/caidos', chat: { id: '-100200300' } },
      });

      expect(prisma.enlaceRecinto.findMany).toHaveBeenCalledWith({ where: { estado: 'FALLO' } });
      expect(telegram.enviarListaActual).toHaveBeenCalledWith([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
      ]);
    });

    it('responde con la lista de caídos cuando se toca el botón fijo del teclado', async () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);

      await service.procesarComandoTelegram('secreto123', {
        message: { text: TEXTO_BOTON_CAIDOS, chat: { id: '-100200300' } },
      });

      expect(telegram.enviarListaActual).toHaveBeenCalledWith([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
      ]);
    });

    it('ignora el botón fijo si viene de un chat distinto al configurado', async () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';

      await service.procesarComandoTelegram('secreto123', {
        message: { text: TEXTO_BOTON_CAIDOS, chat: { id: '-999888777' } },
      });

      expect(telegram.enviarListaActual).not.toHaveBeenCalled();
    });

    it('ignora el update si el secreto recibido no coincide con TELEGRAM_WEBHOOK_SECRET', async () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';

      await service.procesarComandoTelegram('otro-secreto', {
        message: { text: '/caidos', chat: { id: '-100200300' } },
      });

      expect(telegram.enviarListaActual).not.toHaveBeenCalled();
    });

    it('ignora el update si TELEGRAM_WEBHOOK_SECRET no está configurado', async () => {
      process.env.TELEGRAM_CHAT_ID = '-100200300';

      await service.procesarComandoTelegram('secreto123', {
        message: { text: '/caidos', chat: { id: '-100200300' } },
      });

      expect(telegram.enviarListaActual).not.toHaveBeenCalled();
    });

    it('ignora el comando si viene de un chat distinto al configurado', async () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';

      await service.procesarComandoTelegram('secreto123', {
        message: { text: '/caidos', chat: { id: '-999888777' } },
      });

      expect(telegram.enviarListaActual).not.toHaveBeenCalled();
    });

    it('ignora texto que no es el comando /caidos', async () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';

      await service.procesarComandoTelegram('secreto123', {
        message: { text: 'hola', chat: { id: '-100200300' } },
      });

      expect(telegram.enviarListaActual).not.toHaveBeenCalled();
    });

    it('ignora un update sin mensaje de texto o sin chat', async () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';

      await service.procesarComandoTelegram('secreto123', {});

      expect(telegram.enviarListaActual).not.toHaveBeenCalled();
    });
  });
});
