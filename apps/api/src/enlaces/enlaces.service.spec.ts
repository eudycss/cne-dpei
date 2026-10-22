import { Test } from '@nestjs/testing';
import { EnlacesService, tipoChatTelegram } from './enlaces.service';
import { PrismaService } from '../db/prisma.service';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import {
  TelegramNotifier,
  TEXTO_BOTON_CAIDOS,
  TEXTO_BOTON_ESTADISTICAS,
  TEXTO_BOTON_INGRESAR_CODIGO,
  TEXTO_BOTON_PREGUNTAR,
} from './telegram-notifier';
import { AsistenteService } from './asistente/asistente.service';
import { EnlacesEstadisticasService } from './enlaces-estadisticas.service';
import { DistributivoTecnicosClient } from './distributivo-tecnicos.client';
import { EnlacesEscalamientoService } from './enlaces-escalamiento.service';
import { EncargadosRecintosClient } from './encargados-recintos.client';
import { NotificationsService } from '../notifications/notifications.service';

const sendEnlaceCaido = jest.fn().mockResolvedValue(undefined);
const sendEnlaceRecuperado = jest.fn().mockResolvedValue(undefined);

jest.mock('../auth/notifier', () => ({
  resolveNotifier: () => ({ sendEnlaceCaido, sendEnlaceRecuperado }),
}));

describe('EnlacesService', () => {
  let service: EnlacesService;

  const escalamiento = { escalar: jest.fn().mockResolvedValue(undefined) };
  const distributivo = { asignaciones: jest.fn() };
  const encargados = { encargados: jest.fn() };

  const prisma = {
    enlaceRecinto: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    configEnlaces: { findUnique: jest.fn(), upsert: jest.fn() },
    enlaceCaida: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const estadisticas = {
    enviarEstadisticasTelegram: jest.fn().mockResolvedValue(undefined),
    mostrarPeriodoTelegram: jest.fn().mockResolvedValue(undefined),
  };
  const sheetsClient = { leerEnlacesImbabura: jest.fn() };
  const telegram = {
    enviarListaActual: jest.fn().mockResolvedValue(undefined),
    enviarRecuperados: jest.fn().mockResolvedValue(undefined),
    enviarTexto: jest.fn().mockResolvedValue(undefined),
    responderBoton: jest.fn().mockResolvedValue(undefined),
    responderEn: jest.fn((_chatId: string, fn: () => Promise<unknown>) => fn()),
  };
  const notifications = { encolarEnlaceCaido: jest.fn().mockResolvedValue(undefined) };
  const asistente = {
    responder: jest.fn().mockResolvedValue(undefined),
    responderRecintoElegido: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    distributivo.asignaciones.mockResolvedValue([]);
    encargados.encargados.mockResolvedValue(new Map());
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnlacesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SheetsEnlacesClient, useValue: sheetsClient },
        { provide: TelegramNotifier, useValue: telegram },
        { provide: NotificationsService, useValue: notifications },
        { provide: EnlacesEstadisticasService, useValue: estadisticas },
        { provide: DistributivoTecnicosClient, useValue: distributivo },
        { provide: EncargadosRecintosClient, useValue: encargados },
        { provide: EnlacesEscalamientoService, useValue: escalamiento },
        { provide: AsistenteService, useValue: asistente },
      ],
    }).compile();
    service = moduleRef.get(EnlacesService);
  });

  describe('revisarEnlaces', () => {
    afterEach(() => {
      delete process.env.ENLACES_CRON_ENABLED;
    });

    it('no hace nada si ENLACES_CRON_ENABLED=false (ej. API local de desarrollo)', async () => {
      process.env.ENLACES_CRON_ENABLED = 'false';

      await service.revisarEnlaces();

      expect(sheetsClient.leerEnlacesImbabura).not.toHaveBeenCalled();
      expect(prisma.enlaceRecinto.upsert).not.toHaveBeenCalled();
      expect(notifications.encolarEnlaceCaido).not.toHaveBeenCalled();
      expect(telegram.enviarListaActual).not.toHaveBeenCalled();
      expect(escalamiento.escalar).not.toHaveBeenCalled();
    });

    it('también se desactiva con mayúsculas o espacios (" FALSE ")', async () => {
      process.env.ENLACES_CRON_ENABLED = ' FALSE ';

      await service.revisarEnlaces();

      expect(sheetsClient.leerEnlacesImbabura).not.toHaveBeenCalled();
    });

    it.each([
      ['sin definir (caso de producción)', undefined],
      ['"true"', 'true'],
    ])('sigue revisando si ENLACES_CRON_ENABLED está %s', async (_caso, valor) => {
      if (valor === undefined) delete process.env.ENLACES_CRON_ENABLED;
      else process.env.ENLACES_CRON_ENABLED = valor;
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([]);

      await service.revisarEnlaces();

      expect(sheetsClient.leerEnlacesImbabura).toHaveBeenCalledTimes(1);
    });

    it('notifica cuando un enlace pasa de ACTIVO a FALLO', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ codigoRecinto: '978', estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.upsert).toHaveBeenCalledTimes(1);
      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null }],
        new Set(['978']),
        undefined,
        expect.any(Map),
      );
      expect(notifications.encolarEnlaceCaido).toHaveBeenCalledWith({
        codigoRecinto: '978',
        nombreRecinto: 'Escuela Central',
      });
      expect(sendEnlaceCaido).toHaveBeenCalledTimes(1);
      expect(sendEnlaceCaido).toHaveBeenCalledWith(
        ['a@b.com'],
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null }],
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
          { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null },
          { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', canton: null },
        ],
      );
      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [
          { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null },
          { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', canton: null },
        ],
        new Set(['978', '982']),
        undefined,
        expect.any(Map),
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
          { codigoRecinto: '111', nombreRecinto: 'Ya caído', canton: null },
          { codigoRecinto: '222', nombreRecinto: 'Recién cae', canton: null },
        ],
        new Set(['222']),
        undefined,
        expect.any(Map),
      );
    });

    it('pasa a Telegram el cantón normalizado de la hoja, tanto en caídos como en recuperados', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '111', nombreRecinto: 'Cae', canton: 'COTACACHI', estado: 'FALLO' },
        { codigoRecinto: '222', nombreRecinto: 'Vuelve', canton: 'otavalo', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique
        .mockResolvedValueOnce({ estado: 'ACTIVO' })
        .mockResolvedValueOnce({ estado: 'FALLO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });

      await service.revisarEnlaces();

      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [{ codigoRecinto: '111', nombreRecinto: 'Cae', canton: 'Cotacachi' }],
        new Set(['111']),
        undefined,
        expect.any(Map),
      );
      expect(telegram.enviarRecuperados).toHaveBeenCalledWith([
        { codigoRecinto: '222', nombreRecinto: 'Vuelve', canton: 'Otavalo' },
      ], expect.any(Map));
    });

    it('pasa a Telegram el técnico y a quién llamar de cada recinto recién caído', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '111', nombreRecinto: 'Ya caído', estado: 'FALLO' },
        { codigoRecinto: '222', nombreRecinto: 'Recién cae', estado: 'FALLO' },
        { codigoRecinto: '333', nombreRecinto: 'Sin datos', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique
        .mockResolvedValueOnce({ estado: 'FALLO' })
        .mockResolvedValueOnce({ estado: 'ACTIVO' })
        .mockResolvedValueOnce({ estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      distributivo.asignaciones.mockResolvedValue([
        { codigoRecinto: '222', localidad: '', parroquia: '', numeroTecnico: 1, tecnico: 'Ana Pérez' },
      ]);
      encargados.encargados.mockResolvedValue(
        new Map([['222', { nombre: 'Rector Juana Ejemplo 0990000000', telefono: '' }]]),
      );

      await service.revisarEnlaces();

      const contactos = telegram.enviarListaActual.mock.calls[0][3];
      expect([...contactos.keys()]).toEqual(['222', '333']);
      expect(contactos.get('222')).toEqual({
        tecnico: 'Ana Pérez',
        encargado: { nombre: 'Rector Juana Ejemplo 0990000000', telefono: '' },
      });
      expect(contactos.get('333')).toEqual({ tecnico: null, encargado: null });
    });

    it('junta los técnicos de un recinto que tiene más de uno, sin repetir', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '222', nombreRecinto: 'Recién cae', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      distributivo.asignaciones.mockResolvedValue([
        { codigoRecinto: '222', localidad: 'A', parroquia: '', numeroTecnico: 1, tecnico: 'Ana Pérez' },
        { codigoRecinto: '222', localidad: 'B', parroquia: '', numeroTecnico: 2, tecnico: 'Luis Gómez' },
        { codigoRecinto: '222', localidad: 'C', parroquia: '', numeroTecnico: 1, tecnico: 'Ana Pérez' },
      ]);

      await service.revisarEnlaces();

      const contactos = telegram.enviarListaActual.mock.calls[0][3];
      expect(contactos.get('222').tecnico).toBe('Ana Pérez, Luis Gómez');
    });

    it('si solo falla un archivo de Drive, usa lo que sí pudo leer', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '222', nombreRecinto: 'Recién cae', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      distributivo.asignaciones.mockRejectedValue(new Error('Drive caído'));
      encargados.encargados.mockResolvedValue(new Map([['222', { nombre: 'Juana Ejemplo', telefono: '099' }]]));

      await service.revisarEnlaces();

      const contactos = telegram.enviarListaActual.mock.calls[0][3];
      expect(contactos.get('222')).toEqual({ tecnico: null, encargado: { nombre: 'Juana Ejemplo', telefono: '099' } });
    });

    it('avisa la caída aunque no se puedan leer el distributivo ni los encargados', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '222', nombreRecinto: 'Recién cae', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      distributivo.asignaciones.mockRejectedValue(new Error('Drive caído'));
      encargados.encargados.mockRejectedValue(new Error('Drive caído'));

      await service.revisarEnlaces();

      const contactos = telegram.enviarListaActual.mock.calls[0][3];
      expect(contactos.get('222')).toEqual({ tecnico: null, encargado: null });
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
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null }],
        new Set(['978']),
        undefined,
        expect.any(Map),
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
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null }],
        new Set(['978']),
        undefined,
        expect.any(Map),
      );
      expect(notifications.encolarEnlaceCaido).toHaveBeenCalledWith({
        codigoRecinto: '978',
        nombreRecinto: 'Escuela Central',
      });
      expect(sendEnlaceCaido).toHaveBeenCalledWith(
        ['a@b.com'],
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null }],
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
      expect(prisma.enlaceRecinto.deleteMany).not.toHaveBeenCalled();
      expect(telegram.enviarListaActual).not.toHaveBeenCalled();
    });

    it('elimina de la tabla los recintos que ya no están en la hoja (ej. borraron el 1207)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
        { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      prisma.enlaceRecinto.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1); // total, a eliminar
      prisma.enlaceRecinto.deleteMany.mockResolvedValueOnce({ count: 1 });

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.deleteMany).toHaveBeenCalledWith({
        where: { codigoRecinto: { notIn: ['978', '982'] } },
      });
    });

    describe('historial de caídas (estadísticas)', () => {
      const fila = (codigo: string, estado: string) => ({
        codigoRecinto: codigo,
        nombreRecinto: `Recinto ${codigo}`,
        canton: 'IBARRA',
        estado,
      });

      beforeEach(() => {
        prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
        prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
        prisma.enlaceCaida.findMany.mockResolvedValue([]);
      });

      it('abre una caída para cada recinto en FALLO que no tenga una abierta', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([fila('978', 'FALLO'), fila('982', 'FALLO'), fila('28', 'ACTIVO')]);
        prisma.enlaceCaida.findMany.mockResolvedValue([{ codigoRecinto: '982', inicio: new Date() }]);

        await service.revisarEnlaces();

        expect(prisma.enlaceCaida.findMany).toHaveBeenCalledWith({ where: { fin: null }, select: { codigoRecinto: true, inicio: true } });
        expect(prisma.enlaceCaida.createMany).toHaveBeenCalledWith({
          data: [{ codigoRecinto: '978', nombreRecinto: 'Recinto 978', canton: 'Ibarra', inicio: expect.any(Date) }],
          skipDuplicates: true,
        });
      });

      it('cierra las caídas abiertas de los recintos que están ACTIVO', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([fila('978', 'ACTIVO'), fila('28', 'ACTIVO')]);
        prisma.enlaceCaida.findMany.mockResolvedValue([{ codigoRecinto: '978', inicio: new Date() }]);

        await service.revisarEnlaces();

        expect(prisma.enlaceCaida.updateMany).toHaveBeenCalledWith({
          where: { codigoRecinto: { in: ['978', '28'] }, fin: null },
          data: { fin: expect.any(Date) },
        });
        expect(prisma.enlaceCaida.createMany).not.toHaveBeenCalled();
      });

      it('al recuperarse, Telegram dice cuánto duró la caída', async () => {
        prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'FALLO' });
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([fila('978', 'ACTIVO')]);
        prisma.enlaceCaida.findMany.mockResolvedValue([
          { codigoRecinto: '978', inicio: new Date(Date.now() - 42 * 60_000) },
        ]);

        await service.revisarEnlaces();

        const [, minutos] = telegram.enviarRecuperados.mock.calls[0];
        expect(minutos.get('978')).toBe(42);
      });

      it('si el historial no se pudo actualizar, no escala (podría avisar de un enlace que ya volvió)', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([fila('978', 'FALLO')]);
        prisma.enlaceCaida.findMany.mockRejectedValueOnce(new Error('base caída'));

        await service.revisarEnlaces();

        expect(escalamiento.escalar).not.toHaveBeenCalled();
      });

      it('cada ciclo revisa el escalamiento (avisos de 30 min), después del historial', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([fila('978', 'FALLO')]);

        await service.revisarEnlaces();

        expect(escalamiento.escalar).toHaveBeenCalledTimes(1);
        expect(prisma.enlaceCaida.createMany.mock.invocationCallOrder[0]).toBeLessThan(
          escalamiento.escalar.mock.invocationCallOrder[0],
        );
      });

      it('sin cambios no escribe nada (FALLO con caída abierta, ACTIVO sin abierta)', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([fila('978', 'FALLO'), fila('28', 'ACTIVO')]);
        prisma.enlaceCaida.findMany.mockResolvedValue([{ codigoRecinto: '978', inicio: new Date() }]);

        await service.revisarEnlaces();

        expect(prisma.enlaceCaida.createMany).not.toHaveBeenCalled();
        expect(prisma.enlaceCaida.updateMany).not.toHaveBeenCalled();
      });

      it('si un ciclo no pudo cerrar la caída, el siguiente la cierra igual (ACTIVO→ACTIVO)', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([fila('978', 'ACTIVO')]);
        prisma.enlaceCaida.findMany.mockResolvedValue([{ codigoRecinto: '978', inicio: new Date() }]);

        await service.revisarEnlaces();

        expect(prisma.enlaceCaida.updateMany).toHaveBeenCalled();
      });

      it('si un ciclo no pudo abrirla, el siguiente la abre igual (FALLO→FALLO) sin volver a avisar', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([fila('978', 'FALLO')]);
        prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'FALLO' });

        await service.revisarEnlaces();

        expect(prisma.enlaceCaida.createMany).toHaveBeenCalled();
        expect(telegram.enviarListaActual).not.toHaveBeenCalled();
      });

      it('un error de la base en el historial no frena los avisos del ciclo', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([fila('978', 'FALLO')]);
        prisma.enlaceCaida.findMany.mockRejectedValueOnce(new Error('conexión perdida'));

        await expect(service.revisarEnlaces()).resolves.toBeUndefined();

        expect(telegram.enviarListaActual).toHaveBeenCalled();
        expect(notifications.encolarEnlaceCaido).toHaveBeenCalled();
      });

      it('los recintos que salen de la hoja cierran su caída abierta', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([fila('978', 'ACTIVO')]);
        prisma.enlaceRecinto.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
        prisma.enlaceRecinto.deleteMany.mockResolvedValueOnce({ count: 1 });

        await service.revisarEnlaces();

        expect(prisma.enlaceCaida.updateMany).toHaveBeenCalledWith({
          where: { codigoRecinto: { notIn: ['978'] }, fin: null },
          data: { fin: expect.any(Date) },
        });
      });
    });

    it('NO borra si dejaría fuera más de la mitad de la tabla — se asume lectura parcial de la hoja', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
      prisma.enlaceRecinto.count.mockResolvedValueOnce(137).mockResolvedValueOnce(136);

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.deleteMany).not.toHaveBeenCalled();
    });

    it('no llama a deleteMany si no hay nada que eliminar', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
      prisma.enlaceRecinto.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.deleteMany).not.toHaveBeenCalled();
    });

    it('no elimina un recinto que sigue en la hoja aunque su upsert haya fallado', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
        { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
      prisma.enlaceRecinto.upsert.mockRejectedValueOnce(new Error('violates constraint'));
      prisma.enlaceRecinto.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.deleteMany).toHaveBeenCalledWith({
        where: { codigoRecinto: { notIn: ['978', '982'] } },
      });
    });

    it('NO borra nada si la hoja no trae filas de Imbabura — una hoja vacía o mal leída no debe vaciar la tabla', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([]);

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.deleteMany).not.toHaveBeenCalled();
    });

    it('un fallo al eliminar recintos no impide las notificaciones del ciclo', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });
      prisma.enlaceRecinto.count.mockRejectedValueOnce(new Error('timeout de base'));

      await expect(service.revisarEnlaces()).resolves.toBeUndefined();

      expect(telegram.enviarListaActual).toHaveBeenCalled();
      expect(sendEnlaceCaido).toHaveBeenCalled();
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
          { codigoRecinto: '978', nombreRecinto: 'Escuela Rota', canton: null },
          { codigoRecinto: '982', nombreRecinto: 'Escuela Sana', canton: null },
        ],
        new Set(['982']),
        undefined,
        expect.any(Map),
      );
      expect(sendEnlaceCaido).toHaveBeenCalledWith(
        ['a@b.com'],
        [{ codigoRecinto: '982', nombreRecinto: 'Escuela Sana', canton: null }],
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
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null }],
      );
      expect(telegram.enviarRecuperados).toHaveBeenCalledWith([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null },
      ], expect.any(Map));
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
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null },
      ], expect.any(Map));
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
        [{ codigoRecinto: '222', nombreRecinto: 'Recién cae', canton: null }],
      );
      expect(sendEnlaceRecuperado).toHaveBeenCalledWith(
        ['a@b.com'],
        [{ codigoRecinto: '111', nombreRecinto: 'Se recupera', canton: null }],
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

  describe('frecuencia de avisos por Telegram', () => {
    it('getConfig devuelve la frecuencia guardada', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [], minutosPrimerAviso: 10, minutosRepetirAviso: 30 });

      await expect(service.getConfig()).resolves.toEqual({ correos: [], minutosPrimerAviso: 10, minutosRepetirAviso: 30 });
    });

    it('sin configuración guardada, getConfig devuelve 2 h y 2 h', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue(null);

      await expect(service.getConfig()).resolves.toEqual({ correos: [], minutosPrimerAviso: 120, minutosRepetirAviso: 120 });
    });

    it('guardarAvisos guarda solo la frecuencia (no toca los correos) y devuelve la config completa', async () => {
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: ['a@b.com'], minutosPrimerAviso: 10, minutosRepetirAviso: 10 });

      const result = await service.guardarAvisos({ minutosPrimerAviso: 10, minutosRepetirAviso: 10 });

      expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith({
        where: { id: 1 },
        create: { id: 1, minutosPrimerAviso: 10, minutosRepetirAviso: 10 },
        update: { minutosPrimerAviso: 10, minutosRepetirAviso: 10 },
      });
      expect(result).toEqual({ correos: ['a@b.com'], minutosPrimerAviso: 10, minutosRepetirAviso: 10 });
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

    it('pasa el cantón de cada recinto para que Telegram lo muestre abreviado', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        { codigoRecinto: '1207', nombreRecinto: 'Escuela Guallupe', canton: 'Cotacachi', estado: 'FALLO' },
      ]);

      await service.reenviarListaTelegram();

      expect(telegram.enviarListaActual).toHaveBeenCalledWith([
        { codigoRecinto: '1207', nombreRecinto: 'Escuela Guallupe', canton: 'Cotacachi' },
      ]);
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

    it.each([['/estadisticas'], ['/estadisticas@cne_bot'], [TEXTO_BOTON_ESTADISTICAS]])('"%s" responde con las estadísticas', async (texto) => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';

      await service.procesarComandoTelegram('secreto123', {
        message: { text: texto, chat: { id: '-100200300' } },
      });

      expect(estadisticas.enviarEstadisticasTelegram).toHaveBeenCalledTimes(1);
      expect(telegram.enviarListaActual).not.toHaveBeenCalled();
    });

    it('si las estadísticas fallan, avisa en el grupo en vez de quedarse callado', async () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      estadisticas.enviarEstadisticasTelegram.mockRejectedValueOnce(new Error('base caída'));

      await service.procesarComandoTelegram('secreto123', {
        message: { text: TEXTO_BOTON_ESTADISTICAS, chat: { id: '-100200300' } },
      });

      expect(telegram.enviarTexto).toHaveBeenCalledWith(
        expect.stringContaining('No se pudieron calcular las estadísticas'),
        expect.any(String),
      );
    });

    describe('grupos de consulta (TELEGRAM_CHAT_IDS_CONSULTA)', () => {
      beforeEach(() => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        process.env.TELEGRAM_CHAT_IDS_CONSULTA = ' -100777 , -100999 ';
        prisma.enlaceRecinto.findMany.mockResolvedValue([]);
      });
      afterEach(() => {
        delete process.env.TELEGRAM_CHAT_IDS_CONSULTA;
      });

      it('un grupo de consulta puede usar /caidos y la respuesta va a su propio chat', async () => {
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '/caidos', chat: { id: '-100999' } },
        });

        expect(telegram.responderEn).toHaveBeenCalledWith('-100999', expect.any(Function));
        expect(telegram.enviarListaActual).toHaveBeenCalledTimes(1);
      });

      it('el grupo principal sigue respondiendo como siempre, sin cambiar de destino', async () => {
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '/caidos', chat: { id: '-100200300' } },
        });

        expect(telegram.responderEn).not.toHaveBeenCalled();
        expect(telegram.enviarListaActual).toHaveBeenCalledTimes(1);
      });

      it('un chat que no está en la lista se sigue ignorando', async () => {
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '/caidos', chat: { id: '-100555' } },
        });

        expect(telegram.responderEn).not.toHaveBeenCalled();
        expect(telegram.enviarListaActual).not.toHaveBeenCalled();
      });

      it('sin TELEGRAM_CHAT_ID el bot está apagado también para los grupos de consulta', async () => {
        delete process.env.TELEGRAM_CHAT_ID;

        await service.procesarComandoTelegram('secreto123', {
          message: { text: '/caidos', chat: { id: '-100999' } },
        });

        expect(telegram.enviarListaActual).not.toHaveBeenCalled();
      });

      it('los botones Hoy/Semana/Mes desde un grupo de consulta editan el mensaje en ese grupo', async () => {
        await service.procesarComandoTelegram('secreto123', {
          callback_query: { id: 'cb-9', data: 'est:dia', message: { message_id: 88, chat: { id: '-100777' } } },
        });

        expect(telegram.responderEn).toHaveBeenCalledWith('-100777', expect.any(Function));
        expect(telegram.responderBoton).toHaveBeenCalledWith('cb-9');
        expect(estadisticas.mostrarPeriodoTelegram).toHaveBeenCalledWith('dia', 88);
      });

      it('un toque en el grupo principal no frena el de otro chat con el mismo message_id', async () => {
        const boton = (chatId: string) => ({
          callback_query: { id: 'cb', data: 'est:mes', message: { message_id: 50, chat: { id: chatId } } },
        });
        await service.procesarComandoTelegram('secreto123', boton('-100200300'));
        await service.procesarComandoTelegram('secreto123', boton('-100999'));

        expect(estadisticas.mostrarPeriodoTelegram).toHaveBeenCalledTimes(2);
      });

      it('"Ingresar código" desde un grupo de consulta pregunta y responde en ese grupo', async () => {
        prisma.enlaceRecinto.findUnique.mockResolvedValue({ codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' });
        const msg = (text: string) => ({ message: { text, chat: { id: '-100999' }, from: { id: 111 } } });

        await service.procesarComandoTelegram('secreto123', msg(TEXTO_BOTON_INGRESAR_CODIGO));
        await service.procesarComandoTelegram('secreto123', msg('978'));

        expect(telegram.responderEn).toHaveBeenCalledTimes(2);
        expect(telegram.responderEn).toHaveBeenCalledWith('-100999', expect.any(Function));
        expect(telegram.enviarTexto).toHaveBeenLastCalledWith(expect.stringContaining('Escuela Central'), expect.any(String));
      });

      it('una espera de código abierta en el grupo principal no se consume desde un grupo de consulta', async () => {
        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '978', chat: { id: '-100999' }, from: { id: 111 } },
        });

        expect(prisma.enlaceRecinto.findUnique).not.toHaveBeenCalled();
      });

      it('un botón desde un chat que no está en la lista se ignora', async () => {
        await service.procesarComandoTelegram('secreto123', {
          callback_query: { id: 'cb', data: 'est:mes', message: { message_id: 51, chat: { id: '-100555' } } },
        });

        expect(telegram.responderBoton).not.toHaveBeenCalled();
        expect(telegram.responderEn).not.toHaveBeenCalled();
      });
    });

    describe('tipoChatTelegram', () => {
      afterEach(() => {
        delete process.env.TELEGRAM_CHAT_ID;
        delete process.env.TELEGRAM_CHAT_IDS_CONSULTA;
      });

      it('sin TELEGRAM_CHAT_IDS_CONSULTA solo reconoce el grupo principal (como antes)', () => {
        process.env.TELEGRAM_CHAT_ID = '-100200300';

        expect(tipoChatTelegram(-100200300)).toBe('principal');
        expect(tipoChatTelegram('-100999')).toBeNull();
      });

      it('tolera espacios y comas sobrantes, y el principal gana si también está en la lista', () => {
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        process.env.TELEGRAM_CHAT_IDS_CONSULTA = ',, -100999 ,-100200300, ';

        expect(tipoChatTelegram(-100999)).toBe('consulta');
        expect(tipoChatTelegram('-100200300')).toBe('principal');
        expect(tipoChatTelegram('')).toBeNull();
      });
    });

    it('con el notificador real, la respuesta a un grupo de consulta sale con el chat_id de ese grupo', async () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      process.env.TELEGRAM_CHAT_IDS_CONSULTA = '-100999';
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      const fetchOriginal = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      prisma.enlaceRecinto.findMany.mockResolvedValue([]);
      try {
        const moduleRef = await Test.createTestingModule({
          providers: [
            EnlacesService,
            TelegramNotifier,
            { provide: PrismaService, useValue: prisma },
            { provide: SheetsEnlacesClient, useValue: sheetsClient },
            { provide: NotificationsService, useValue: notifications },
            { provide: EnlacesEstadisticasService, useValue: estadisticas },
            { provide: DistributivoTecnicosClient, useValue: distributivo },
            { provide: EncargadosRecintosClient, useValue: encargados },
            { provide: EnlacesEscalamientoService, useValue: escalamiento },
            { provide: AsistenteService, useValue: asistente },
          ],
        }).compile();
        const real = moduleRef.get(EnlacesService);

        await real.procesarComandoTelegram('secreto123', { message: { text: '/caidos', chat: { id: '-100999' } } });
        await real.reenviarListaTelegram();

        const chats = (global.fetch as jest.Mock).mock.calls.map(([, o]) => JSON.parse(o.body).chat_id);
        expect(chats).toEqual(['-100999', '-100200300']);
      } finally {
        global.fetch = fetchOriginal;
        delete process.env.TELEGRAM_CHAT_IDS_CONSULTA;
        delete process.env.TELEGRAM_BOT_TOKEN;
      }
    });

    describe('botones Hoy/Semana/Mes de la tarjeta', () => {
      const boton = (data: string, chatId: string = '-100200300') => ({
        callback_query: { id: 'cb-1', data, message: { message_id: 77, chat: { id: chatId } } },
      });

      beforeEach(() => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
      });

      it.each([['est:dia', 'dia'], ['est:semana', 'semana'], ['est:mes', 'mes']])(
        '"%s" contesta el toque y cambia el mismo mensaje a ese período',
        async (data, periodo) => {
          await service.procesarComandoTelegram('secreto123', boton(data));

          expect(telegram.responderBoton).toHaveBeenCalledWith('cb-1');
          expect(estadisticas.mostrarPeriodoTelegram).toHaveBeenCalledWith(periodo, 77);
        },
      );

      it.each([['est:anio'], ['est:dia;x'], ['otra'], ['']])('un callback_data desconocido ("%s") solo se contesta', async (data) => {
        await service.procesarComandoTelegram('secreto123', boton(data));

        expect(telegram.responderBoton).toHaveBeenCalledWith('cb-1');
        expect(estadisticas.mostrarPeriodoTelegram).not.toHaveBeenCalled();
      });

      it('contesta el toque antes de calcular', async () => {
        await service.procesarComandoTelegram('secreto123', boton('est:mes'));

        expect(telegram.responderBoton.mock.invocationCallOrder[0]).toBeLessThan(
          estadisticas.mostrarPeriodoTelegram.mock.invocationCallOrder[0],
        );
      });

      it('toques seguidos sobre el mismo mensaje no recalculan cada vez', async () => {
        await service.procesarComandoTelegram('secreto123', boton('est:mes'));
        await service.procesarComandoTelegram('secreto123', boton('est:semana'));

        expect(telegram.responderBoton).toHaveBeenCalledTimes(2);
        expect(estadisticas.mostrarPeriodoTelegram).toHaveBeenCalledTimes(1);
      });

      it('un botón sin mensaje (modo inline) se ignora', async () => {
        await service.procesarComandoTelegram('secreto123', { callback_query: { id: 'cb-1', data: 'est:mes' } });

        expect(estadisticas.mostrarPeriodoTelegram).not.toHaveBeenCalled();
      });

      it('un botón desde otro chat se ignora', async () => {
        await service.procesarComandoTelegram('secreto123', boton('est:mes', '-999'));

        expect(telegram.responderBoton).not.toHaveBeenCalled();
        expect(estadisticas.mostrarPeriodoTelegram).not.toHaveBeenCalled();
      });

      it('sin el secreto del webhook se ignora', async () => {
        await service.procesarComandoTelegram('otro', boton('est:mes'));

        expect(estadisticas.mostrarPeriodoTelegram).not.toHaveBeenCalled();
      });

      it('si el cálculo falla, avisa en el grupo', async () => {
        estadisticas.mostrarPeriodoTelegram.mockRejectedValueOnce(new Error('base caída'));

        await service.procesarComandoTelegram('secreto123', boton('est:semana'));

        expect(telegram.responderBoton).toHaveBeenCalledWith('cb-1');
        expect(telegram.enviarTexto).toHaveBeenCalledWith(
          expect.stringContaining('No se pudieron calcular las estadísticas'),
          expect.any(String),
        );
      });
    });

    it('el botón de estadísticas desde otro chat se ignora', async () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';

      await service.procesarComandoTelegram('secreto123', {
        message: { text: TEXTO_BOTON_ESTADISTICAS, chat: { id: '-999' } },
      });

      expect(estadisticas.enviarEstadisticasTelegram).not.toHaveBeenCalled();
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

    it('ignora el update si el secreto tiene la misma longitud pero no coincide', async () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';

      await service.procesarComandoTelegram('secreto456', {
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

    describe('flujo de "Ingresar código"', () => {
      it('al tocar el botón, manda el prompt y todavía no busca nada', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });

        expect(telegram.enviarTexto).toHaveBeenCalledWith(
          expect.stringMatching(/código/i),
          expect.any(String),
        );
        expect(prisma.enlaceRecinto.findUnique).not.toHaveBeenCalled();
      });

      it('responde con código, nombre y estado cuando la persona manda el código tras tocar el botón', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        prisma.enlaceRecinto.findUnique.mockResolvedValue({
          codigoRecinto: '978',
          nombreRecinto: 'Escuela Central',
          estado: 'FALLO',
        });

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '978', chat: { id: '-100200300' }, from: { id: 111 } },
        });

        expect(prisma.enlaceRecinto.findUnique).toHaveBeenCalledWith({
          where: { codigoRecinto: '978' },
          select: { codigoRecinto: true, nombreRecinto: true, canton: true, estado: true },
        });
        expect(telegram.enviarTexto).toHaveBeenLastCalledWith(
          expect.stringContaining('Escuela Central'),
          expect.any(String),
        );
      });

      it('incluye el cantón abreviado junto al código en la respuesta de la búsqueda', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        prisma.enlaceRecinto.findUnique.mockResolvedValue({
          codigoRecinto: '978',
          nombreRecinto: 'Escuela Central',
          canton: 'Ibarra',
          estado: 'ACTIVO',
        });

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '978', chat: { id: '-100200300' }, from: { id: 111 } },
        });

        expect(telegram.enviarTexto).toHaveBeenLastCalledWith(
          expect.stringContaining('📍 978 (Iba) — Escuela Central'),
          expect.any(String),
        );
      });

      it.each([[null], ['Internet']])(
        'sin abreviatura (cantón %p) la búsqueda no deja paréntesis vacíos',
        async (canton) => {
          process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
          process.env.TELEGRAM_CHAT_ID = '-100200300';
          prisma.enlaceRecinto.findUnique.mockResolvedValue({
            codigoRecinto: 'CPE',
            nombreRecinto: 'CPE - IMBABURA',
            canton,
            estado: 'FALLO',
          });

          await service.procesarComandoTelegram('secreto123', {
            message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
          });
          await service.procesarComandoTelegram('secreto123', {
            message: { text: 'CPE', chat: { id: '-100200300' }, from: { id: 111 } },
          });

          expect(telegram.enviarTexto).toHaveBeenLastCalledWith(
            expect.stringContaining('📍 CPE — CPE - IMBABURA'),
            expect.any(String),
          );
        },
      );

      it('avisa si el código no existe, en vez de quedarse callado', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        prisma.enlaceRecinto.findUnique.mockResolvedValue(null);

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '9999', chat: { id: '-100200300' }, from: { id: 111 } },
        });

        expect(telegram.enviarTexto).toHaveBeenLastCalledWith(
          expect.stringMatching(/no se encontró/i),
          expect.any(String),
        );
      });

      it('no interpreta el mensaje de otra persona del grupo como el código', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: 'hola a todos', chat: { id: '-100200300' }, from: { id: 222 } },
        });

        expect(prisma.enlaceRecinto.findUnique).not.toHaveBeenCalled();
      });

      it('solo usa el mensaje inmediato siguiente — el segundo mensaje ya no se busca como código', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        prisma.enlaceRecinto.findUnique.mockResolvedValue({
          codigoRecinto: '978',
          nombreRecinto: 'Escuela Central',
          estado: 'ACTIVO',
        });

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '978', chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '982', chat: { id: '-100200300' }, from: { id: 111 } },
        });

        expect(prisma.enlaceRecinto.findUnique).toHaveBeenCalledTimes(1);
      });

      it('ignora el botón de ingresar código si viene de un chat distinto al configurado', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-999888777' }, from: { id: 111 } },
        });

        expect(telegram.enviarTexto).not.toHaveBeenCalled();
      });

      it('ignora el botón si el mensaje no trae remitente identificable (from ausente)', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' } },
        });

        expect(telegram.enviarTexto).not.toHaveBeenCalled();
      });

      it('resuelve la espera de dos personas del mismo chat de forma independiente', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        prisma.enlaceRecinto.findUnique.mockImplementation(({ where }: { where: { codigoRecinto: string } }) =>
          where.codigoRecinto === '978'
            ? { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' }
            : { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', estado: 'ACTIVO' },
        );

        // Persona A y persona B tocan el botón antes de que cualquiera escriba su código.
        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 222 } },
        });

        // A manda su código: no debe afectar la espera pendiente de B.
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '978', chat: { id: '-100200300' }, from: { id: 111 } },
        });
        expect(telegram.enviarTexto).toHaveBeenLastCalledWith(
          expect.stringContaining('Escuela Central'),
          expect.any(String),
        );

        // B manda el suyo después: se resuelve con su propio código, no con el de A.
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '982', chat: { id: '-100200300' }, from: { id: 222 } },
        });
        expect(telegram.enviarTexto).toHaveBeenLastCalledWith(
          expect.stringContaining('Unidad Educativa Zaldumbide'),
          expect.any(String),
        );
        expect(prisma.enlaceRecinto.findUnique).toHaveBeenCalledTimes(2);
      });

      it('tocar el botón varias veces seguidas no acumula esperas para la misma persona', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });

        expect((service as any).esperandoCodigo.size).toBe(1);
      });

      it('una espera vieja (más de 10 minutos) expira y ya no se resuelve como código', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        const ahora = Date.now();
        const spy = jest.spyOn(Date, 'now').mockReturnValue(ahora);

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });

        spy.mockReturnValue(ahora + 11 * 60 * 1000);
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '978', chat: { id: '-100200300' }, from: { id: 111 } },
        });

        expect(prisma.enlaceRecinto.findUnique).not.toHaveBeenCalled();
        spy.mockRestore();
      });

      it('un mensaje vacío o solo espacios no consume la espera de código', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        prisma.enlaceRecinto.findUnique.mockResolvedValue({
          codigoRecinto: '978',
          nombreRecinto: 'Escuela Central',
          estado: 'FALLO',
        });

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '   ', chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '978', chat: { id: '-100200300' }, from: { id: 111 } },
        });

        expect(prisma.enlaceRecinto.findUnique).toHaveBeenCalledTimes(1);
        expect(telegram.enviarTexto).toHaveBeenLastCalledWith(
          expect.stringContaining('Escuela Central'),
          expect.any(String),
        );
      });
    });
  });

  describe('asistente (💬 Preguntar, /preguntar y menciones)', () => {
    const CHAT = '-100200300';
    // null = sin remitente (admin anónimo del grupo).
    const mensaje = (text: string, from: number | null = 111) =>
      service.procesarComandoTelegram('secreto123', {
        message: { text, chat: { id: CHAT }, ...(from === null ? {} : { from: { id: from } }) },
      });

    beforeEach(() => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
      process.env.TELEGRAM_CHAT_ID = CHAT;
      process.env.ASISTENTE_ENABLED = 'true';
      process.env.GROQ_API_KEY = 'gsk_prueba';
    });

    afterEach(() => {
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      delete process.env.TELEGRAM_CHAT_ID;
      delete process.env.ASISTENTE_ENABLED;
      delete process.env.GROQ_API_KEY;
      delete process.env.TELEGRAM_BOT_USERNAME;
    });

    it('un mensaje normal del grupo NO va al asistente (no gasta cuota ni responde charlas)', async () => {
      await mensaje('buenas tardes, ya llamé al rector del colegio Ibarra');

      expect(asistente.responder).not.toHaveBeenCalled();
      expect(telegram.enviarTexto).not.toHaveBeenCalled();
    });

    it('"Preguntar" pide la pregunta y el siguiente mensaje de esa persona va al asistente', async () => {
      await mensaje(TEXTO_BOTON_PREGUNTAR);
      expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringContaining('Escriba su pregunta'), expect.any(String));

      await mensaje('número del encargado del colegio Ibarra');

      expect(asistente.responder).toHaveBeenCalledWith('número del encargado del colegio Ibarra', `${CHAT}:111`);
    });

    it('la espera es por persona: otro miembro que escribe no dispara el asistente', async () => {
      await mensaje(TEXTO_BOTON_PREGUNTAR, 111);
      await mensaje('hola a todos', 222);

      expect(asistente.responder).not.toHaveBeenCalled();
    });

    it('la espera se usa una sola vez', async () => {
      await mensaje(TEXTO_BOTON_PREGUNTAR);
      await mensaje('estado del 1008');
      await mensaje('gracias');

      expect(asistente.responder).toHaveBeenCalledTimes(1);
    });

    it('tocar "Caídos" después de "Preguntar" cancela la pregunta pendiente', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue([]);
      await mensaje(TEXTO_BOTON_PREGUNTAR);
      await mensaje(TEXTO_BOTON_CAIDOS);
      await mensaje('cualquier cosa');

      expect(asistente.responder).not.toHaveBeenCalled();
      expect(telegram.enviarListaActual).toHaveBeenCalled();
    });

    it('"Ingresar código" después de "Preguntar" cambia la espera a código', async () => {
      prisma.enlaceRecinto.findUnique.mockResolvedValue(null);
      await mensaje(TEXTO_BOTON_PREGUNTAR);
      await mensaje(TEXTO_BOTON_INGRESAR_CODIGO);
      await mensaje('1008');

      expect(asistente.responder).not.toHaveBeenCalled();
      expect(prisma.enlaceRecinto.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { codigoRecinto: '1008' } }),
      );
    });

    it.each([
      ['/preguntar qué está caído en Cotacachi', 'qué está caído en Cotacachi'],
      ['/preguntar@CNE_Enlaces_bot qué está caído en Cotacachi', 'qué está caído en Cotacachi'],
      ['/preguntar', ''],
    ])('"%s" va directo al asistente', async (texto, pregunta) => {
      await mensaje(texto);

      expect(asistente.responder).toHaveBeenCalledWith(pregunta, `${CHAT}:111`);
    });

    it('con TELEGRAM_BOT_USERNAME, una mención al bot va al asistente sin la mención', async () => {
      process.env.TELEGRAM_BOT_USERNAME = '@CNE_Enlaces_bot';

      await mensaje('@cne_enlaces_bot teléfono del encargado de la UE San Juan');

      expect(asistente.responder).toHaveBeenCalledWith('teléfono del encargado de la UE San Juan', `${CHAT}:111`);
    });

    it('sin TELEGRAM_BOT_USERNAME, una mención se ignora como cualquier mensaje', async () => {
      await mensaje('@CNE_Enlaces_bot hola');

      expect(asistente.responder).not.toHaveBeenCalled();
    });

    it('con el asistente apagado, /preguntar avisa y no llama al asistente', async () => {
      delete process.env.ASISTENTE_ENABLED;

      await mensaje('/preguntar caídos en Ibarra');

      expect(asistente.responder).not.toHaveBeenCalled();
      expect(telegram.enviarTexto).toHaveBeenCalledWith('El asistente no está activado en este momento.', expect.any(String));
    });

    it('sin remitente identificable (admin anónimo) no se usa el asistente y se explica por qué', async () => {
      await mensaje('/preguntar caídos en Ibarra', null);
      await mensaje(TEXTO_BOTON_PREGUNTAR, null);

      expect(asistente.responder).not.toHaveBeenCalled();
      expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringContaining('modo anónimo'), expect.any(String));
      expect(telegram.enviarTexto).toHaveBeenCalledTimes(2);
    });

    it('"/preguntar@otro_bot" se ignora si TELEGRAM_BOT_USERNAME es otro', async () => {
      process.env.TELEGRAM_BOT_USERNAME = 'CNE_Enlaces_bot';

      await mensaje('/preguntar@otro_bot caídos');
      await mensaje('/preguntar@cne_enlaces_bot caídos');

      expect(asistente.responder).toHaveBeenCalledTimes(1);
      expect(asistente.responder).toHaveBeenCalledWith('caídos', `${CHAT}:111`);
    });

    it('una mención dentro de un correo o de otro usuario no cuenta', async () => {
      process.env.TELEGRAM_BOT_USERNAME = 'CNE_Enlaces_bot';

      await mensaje('escriban a soporte@CNE_Enlaces_bot.ec');
      await mensaje('@CNE_Enlaces_bot_viejo hola');

      expect(asistente.responder).not.toHaveBeenCalled();
    });

    it.each(['-', '@', '@@', '  '])('con TELEGRAM_BOT_USERNAME inválido ("%s") ninguna mención activa el asistente', async (usuario) => {
      process.env.TELEGRAM_BOT_USERNAME = usuario;

      await mensaje('@juan ya está');
      await mensaje('hola @ todos');

      expect(asistente.responder).not.toHaveBeenCalled();
    });

    it('desde un chat no autorizado no se usa el asistente', async () => {
      await service.procesarComandoTelegram('secreto123', {
        message: { text: '/preguntar caídos', chat: { id: '-999' }, from: { id: 111 } },
      });

      expect(asistente.responder).not.toHaveBeenCalled();
    });

    describe('botones de recinto', () => {
      const boton = (data: string, message_id = 50) =>
        service.procesarComandoTelegram('secreto123', {
          callback_query: { id: 'cb1', data, message: { message_id, chat: { id: CHAT } } },
        });

      it('el botón de un recinto muestra su ficha', async () => {
        await boton('asis:rec:1008');

        expect(telegram.responderBoton).toHaveBeenCalledWith('cb1');
        expect(asistente.responderRecintoElegido).toHaveBeenCalledWith('1008');
        expect(estadisticas.mostrarPeriodoTelegram).not.toHaveBeenCalled();
      });

      it.each(['asis:rec:', 'asis:rec:1008;x', `asis:rec:${'1'.repeat(21)}`, 'asis:rec:<b>'])('callback_data inválido "%s" se ignora', async (data) => {
        await boton(data);

        expect(asistente.responderRecintoElegido).not.toHaveBeenCalled();
      });

      it('dos toques seguidos al mismo botón consultan una sola vez', async () => {
        await boton('asis:rec:1008', 77);
        await boton('asis:rec:1008', 77);

        expect(asistente.responderRecintoElegido).toHaveBeenCalledTimes(1);
      });

      it('tocar dos recintos distintos del mismo mensaje responde los dos', async () => {
        await boton('asis:rec:1008', 78);
        await boton('asis:rec:1009', 78);

        expect(asistente.responderRecintoElegido.mock.calls).toEqual([['1008'], ['1009']]);
      });
    });
  });
});
