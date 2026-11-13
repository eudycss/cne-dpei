import { Test } from '@nestjs/testing';
import { EnlacesService, tipoChatTelegram, tipoDeError } from './enlaces.service';
import { PrismaService } from '../db/prisma.service';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import {
  TelegramNotifier,
  TEXTO_BOTON_BUSCAR_RECINTO,
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
  ...jest.requireActual('../auth/notifier'),
  resolveNotifier: () => ({ sendEnlaceCaido, sendEnlaceRecuperado }),
}));

import { JornadaService } from './jornada/jornada.service';

describe('EnlacesService', () => {
  let service: EnlacesService;

  /** Lo guardado tras el ciclo anterior: `confirmado` (lo último avisado) y la lectura
   * de ese ciclo. El anti-parpadeo avisa cuando la lectura de ahora repite la anterior
   * y difiere de lo confirmado: antes('ACTIVO', 'FALLO') + hoja en FALLO = caída. */
  const antes = (confirmado: 'ACTIVO' | 'FALLO' | null, lecturaPrevia: 'ACTIVO' | 'FALLO') => ({
    estado: lecturaPrevia,
    estadoConfirmado: confirmado,
  });

  const escalamiento = { escalar: jest.fn().mockResolvedValue([]) };
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
    // Los NO CDA del buscador (no tienen enlace monitoreado).
    recinto: { findMany: jest.fn(), findFirst: jest.fn() },
    enlaceCaida: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    enlaceRevision: { create: jest.fn().mockResolvedValue({}) },
  };
  const estadisticas = {
    enviarEstadisticasTelegram: jest.fn().mockResolvedValue(undefined),
    mostrarPeriodoTelegram: jest.fn().mockResolvedValue(undefined),
  };
  const sheetsClient = { leerEnlacesImbabura: jest.fn() };
  const telegram = {
    enviarListaActual: jest.fn().mockResolvedValue(undefined),
    enviarAvisoCiclo: jest.fn().mockResolvedValue(undefined),
    publicarTablero: jest.fn().mockResolvedValue(null),
    enviarPendientesTecnico: jest.fn().mockResolvedValue(undefined),
    enviarTexto: jest.fn().mockResolvedValue(undefined),
    enviarHtml: jest.fn().mockResolvedValue(undefined),
    responderBoton: jest.fn().mockResolvedValue(undefined),
    responderEn: jest.fn((_chatId: string, fn: () => Promise<unknown>) => fn()),
  };
  const jornada = {
    atenderMensaje: jest.fn().mockResolvedValue(false),
    atenderBoton: jest.fn().mockResolvedValue(false),
    guardarMinutosResumen: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { encolarEnlaceCaido: jest.fn().mockResolvedValue(undefined) };
  const asistente = {
    responder: jest.fn().mockResolvedValue(undefined),
    responderRecintoElegido: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.recinto.findMany.mockResolvedValue([]);
    prisma.recinto.findFirst.mockResolvedValue(null);
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
        { provide: JornadaService, useValue: jornada },
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
      expect(telegram.enviarAvisoCiclo).not.toHaveBeenCalled();
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
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'FALLO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.upsert).toHaveBeenCalledTimes(1);
      expect(telegram.enviarAvisoCiclo).toHaveBeenCalledWith(
        expect.objectContaining({
          caidos: [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null }],
          nuevos: new Set(['978']),
          contactos: expect.any(Map),
          activos: [],
        }),
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
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'FALLO'));
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
      expect(telegram.enviarAvisoCiclo).toHaveBeenCalledWith(
        expect.objectContaining({
          caidos: [
          { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null },
          { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', canton: null },
        ],
          nuevos: new Set(['978', '982']),
          contactos: expect.any(Map),
          activos: [],
        }),
      );
    });

    it('incluye recintos ya caídos de ciclos anteriores (sin 🆕) junto con el que recién cae (con 🆕) — el caso que motivó este mensaje agrupado', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '111', nombreRecinto: 'Ya caído', estado: 'FALLO' },
        { codigoRecinto: '222', nombreRecinto: 'Recién cae', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique
        .mockResolvedValueOnce(antes('FALLO', 'FALLO')) // 111 ya estaba caído
        .mockResolvedValueOnce(antes('ACTIVO', 'FALLO')); // 222 acaba de caer
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });

      await service.revisarEnlaces();

      expect(telegram.enviarAvisoCiclo).toHaveBeenCalledWith(
        expect.objectContaining({
          caidos: [
          { codigoRecinto: '111', nombreRecinto: 'Ya caído', canton: null },
          { codigoRecinto: '222', nombreRecinto: 'Recién cae', canton: null },
        ],
          nuevos: new Set(['222']),
          contactos: expect.any(Map),
          activos: [],
        }),
      );
    });

    it('pasa a Telegram el cantón normalizado de la hoja, tanto en caídos como en recuperados', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '111', nombreRecinto: 'Cae', canton: 'COTACACHI', estado: 'FALLO' },
        { codigoRecinto: '222', nombreRecinto: 'Vuelve', canton: 'otavalo', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique
        .mockResolvedValueOnce(antes('ACTIVO', 'FALLO'))
        .mockResolvedValueOnce(antes('FALLO', 'ACTIVO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });

      await service.revisarEnlaces();

      expect(telegram.enviarAvisoCiclo).toHaveBeenCalledWith(
        expect.objectContaining({
          caidos: [{ codigoRecinto: '111', nombreRecinto: 'Cae', canton: 'Cotacachi' }],
          nuevos: new Set(['111']),
          contactos: expect.any(Map),
          // Los activos van aparte (para el aviso de "casi todo caído").
          activos: [{ codigoRecinto: '222', nombreRecinto: 'Vuelve', canton: 'Otavalo' }],
        }),
      );
      expect(telegram.enviarAvisoCiclo).toHaveBeenCalledWith(
        expect.objectContaining({
          recuperados: [
        { codigoRecinto: '222', nombreRecinto: 'Vuelve', canton: 'Otavalo' },
          ],
          minutosCaido: expect.any(Map),
        }),
      );
    });

    it('con hasta 4 caídos pasa a Telegram el técnico y a quién llamar de cada uno (no solo de los nuevos)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '111', nombreRecinto: 'Ya caído', estado: 'FALLO' },
        { codigoRecinto: '222', nombreRecinto: 'Recién cae', estado: 'FALLO' },
        { codigoRecinto: '333', nombreRecinto: 'Sin datos', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique
        .mockResolvedValueOnce(antes('FALLO', 'FALLO'))
        .mockResolvedValueOnce(antes('ACTIVO', 'FALLO'))
        .mockResolvedValueOnce(antes('ACTIVO', 'FALLO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      distributivo.asignaciones.mockResolvedValue([
        { codigoRecinto: '222', localidad: '', parroquia: '', numeroTecnico: 1, tecnico: 'Ana Pérez' },
      ]);
      encargados.encargados.mockResolvedValue(
        new Map([['222', { nombre: 'Rector Juana Ejemplo 0990000000', telefono: '' }]]),
      );

      await service.revisarEnlaces();

      const contactos = telegram.enviarAvisoCiclo.mock.calls[0][0].contactos;
      expect([...contactos.keys()]).toEqual(['111', '222', '333']);
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
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'FALLO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      distributivo.asignaciones.mockResolvedValue([
        { codigoRecinto: '222', localidad: 'A', parroquia: '', numeroTecnico: 1, tecnico: 'Ana Pérez' },
        { codigoRecinto: '222', localidad: 'B', parroquia: '', numeroTecnico: 2, tecnico: 'Luis Gómez' },
        { codigoRecinto: '222', localidad: 'C', parroquia: '', numeroTecnico: 1, tecnico: 'Ana Pérez' },
      ]);

      await service.revisarEnlaces();

      const contactos = telegram.enviarAvisoCiclo.mock.calls[0][0].contactos;
      expect(contactos.get('222').tecnico).toBe('Ana Pérez, Luis Gómez');
    });

    it('si solo falla un archivo de Drive, usa lo que sí pudo leer', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '222', nombreRecinto: 'Recién cae', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'FALLO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      distributivo.asignaciones.mockRejectedValue(new Error('Drive caído'));
      encargados.encargados.mockResolvedValue(new Map([['222', { nombre: 'Juana Ejemplo', telefono: '099' }]]));

      await service.revisarEnlaces();

      const contactos = telegram.enviarAvisoCiclo.mock.calls[0][0].contactos;
      expect(contactos.get('222')).toEqual({ tecnico: null, encargado: { nombre: 'Juana Ejemplo', telefono: '099' } });
    });

    it('avisa la caída aunque no se puedan leer el distributivo ni los encargados', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '222', nombreRecinto: 'Recién cae', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'FALLO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      distributivo.asignaciones.mockRejectedValue(new Error('Drive caído'));
      encargados.encargados.mockRejectedValue(new Error('Drive caído'));

      await service.revisarEnlaces();

      const contactos = telegram.enviarAvisoCiclo.mock.calls[0][0].contactos;
      expect(contactos.get('222')).toEqual({ tecnico: null, encargado: null });
    });

    it('un fallo en el envío del correo batcheado no interrumpe el ciclo ni relanza', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'FALLO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });
      sendEnlaceCaido.mockRejectedValueOnce(new Error('Brevo caído'));

      await expect(service.revisarEnlaces()).resolves.toBeUndefined();
      expect(telegram.enviarAvisoCiclo).toHaveBeenCalled();
      expect(notifications.encolarEnlaceCaido).toHaveBeenCalled();
    });

    it('no envía correo si nadie está registrado, aunque sí notifica Telegram e in-app', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'FALLO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });

      await service.revisarEnlaces();

      expect(sendEnlaceCaido).not.toHaveBeenCalled();
      expect(telegram.enviarAvisoCiclo).toHaveBeenCalledWith(
        expect.objectContaining({
          caidos: [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null }],
          nuevos: new Set(['978']),
          contactos: expect.any(Map),
          activos: [],
        }),
      );
    });

    it('NO notifica si el enlace sigue FALLO (ya estaba caído)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('FALLO', 'FALLO'));

      await service.revisarEnlaces();

      expect(telegram.enviarAvisoCiclo).not.toHaveBeenCalled();
      expect(notifications.encolarEnlaceCaido).not.toHaveBeenCalled();
    });

    it('un recinto nuevo que ya llega en FALLO se avisa al confirmarse (2.º ciclo) — no queda mudo', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      // Ciclo 1: primera vez que se ve; puede ser un parpadeo, se espera.
      prisma.enlaceRecinto.findUnique.mockResolvedValueOnce(null);
      await service.revisarEnlaces();
      expect(telegram.enviarAvisoCiclo).not.toHaveBeenCalled();
      expect(prisma.enlaceRecinto.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ estadoConfirmado: null }) }),
      );

      // Ciclo 2: sigue en FALLO y nunca se confirmó nada → caída.
      prisma.enlaceRecinto.findUnique.mockResolvedValueOnce(antes(null, 'FALLO'));
      await service.revisarEnlaces();

      expect(telegram.enviarAvisoCiclo).toHaveBeenCalledWith(
        expect.objectContaining({
          caidos: [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null }],
          nuevos: new Set(['978']),
          contactos: expect.any(Map),
          activos: [],
        }),
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

    describe('tablero fijado', () => {
      const fila = { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' as const };

      beforeEach(() => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([fila]);
        prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'ACTIVO'));
      });

      it('cada ciclo lo actualiza aunque no haya cambios (la hora muestra que el bot sigue vivo)', async () => {
        prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [], tableroMensajeId: 77 });
        telegram.publicarTablero.mockResolvedValueOnce(77);

        await service.revisarEnlaces();

        expect(telegram.enviarAvisoCiclo).not.toHaveBeenCalled();
        expect(telegram.publicarTablero).toHaveBeenCalledWith(
          expect.stringContaining('✅ Todos los enlaces activos (1/1)'),
          undefined,
          77,
        );
        expect(prisma.configEnlaces.upsert).not.toHaveBeenCalled();
      });

      it('si publicó uno nuevo, guarda su id para editarlo en los siguientes ciclos', async () => {
        prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [], tableroMensajeId: null });
        telegram.publicarTablero.mockResolvedValueOnce(90);

        await service.revisarEnlaces();

        expect(telegram.publicarTablero).toHaveBeenCalledWith(expect.any(String), undefined, null);
        expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith({
          where: { id: 1 },
          create: { id: 1, tableroMensajeId: 90 },
          update: { tableroMensajeId: 90 },
        });
      });

      it('si no se pudo publicar, no guarda nada', async () => {
        prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [], tableroMensajeId: null });

        await service.revisarEnlaces();

        expect(prisma.configEnlaces.upsert).not.toHaveBeenCalled();
      });

      it('un error del tablero no frena el ciclo', async () => {
        telegram.publicarTablero.mockRejectedValueOnce(new Error('telegram caído'));

        await expect(service.revisarEnlaces()).resolves.toBeUndefined();
      });

      it('con muchos caídos, el tablero va por técnico con el estado confirmado', async () => {
        const filas = ['1', '2', '3', '4', '5'].map((c) => ({ codigoRecinto: c, nombreRecinto: `R${c}`, estado: 'FALLO' as const }));
        sheetsClient.leerEnlacesImbabura.mockResolvedValue(filas);
        prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('FALLO', 'FALLO'));
        prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [], tableroMensajeId: 77 });
        distributivo.asignaciones.mockResolvedValue(
          filas.map((f) => ({ codigoRecinto: f.codigoRecinto, localidad: '', parroquia: '', numeroTecnico: 1, tecnico: 'Jairo Leal' })),
        );
        // En la tabla la lectura del 5 ya volvió a ACTIVO, pero sigue confirmado en FALLO.
        prisma.enlaceRecinto.findMany.mockResolvedValue(
          filas.map((f) => ({ ...f, canton: null, estado: f.codigoRecinto === '5' ? 'ACTIVO' : 'FALLO', estadoConfirmado: 'FALLO' })),
        );

        await service.revisarEnlaces();

        const [texto, teclado] = telegram.publicarTablero.mock.calls[0];
        expect(texto).toContain('1. Jairo Leal: 5');
        expect(teclado).toEqual({ inline_keyboard: [[{ text: '1. Jairo Leal · 5🔴', callback_data: 'pend:1' }]] });
      });
    });

    describe('anti-parpadeo (varios ciclos sobre la misma tabla)', () => {
      const recinto = { codigoRecinto: '978', nombreRecinto: 'Escuela Central' };
      /** enlaces_recinto en memoria: findUnique lee lo que dejó el upsert del ciclo anterior. */
      const usarTablaEnMemoria = () => {
        const tabla = new Map<string, Record<string, unknown>>();
        prisma.enlaceRecinto.findUnique.mockImplementation(
          async ({ where }: { where: { codigoRecinto: string } }) => tabla.get(where.codigoRecinto) ?? null,
        );
        prisma.enlaceRecinto.upsert.mockImplementation(
          async ({ where, create, update }: { where: { codigoRecinto: string }; create: object; update: object }) => {
            const actual = tabla.get(where.codigoRecinto);
            tabla.set(where.codigoRecinto, actual ? { ...actual, ...update } : { ...create });
          },
        );
      };
      const ciclos = async (...estados: ('ACTIVO' | 'FALLO')[]) => {
        for (const estado of estados) {
          sheetsClient.leerEnlacesImbabura.mockResolvedValueOnce([{ ...recinto, estado }]);
          await service.revisarEnlaces();
        }
      };

      beforeEach(() => {
        prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });
        usarTablaEnMemoria();
      });
      afterEach(() => {
        prisma.enlaceRecinto.findUnique.mockReset();
        prisma.enlaceRecinto.upsert.mockReset();
        prisma.enlaceCaida.findMany.mockReset();
        prisma.enlaceCaida.findMany.mockResolvedValue([]);
      });

      it('un recinto que parpadea (FALLO, ACTIVO, FALLO…) no genera ningún aviso — el caso del 11-nov', async () => {
        await ciclos('ACTIVO', 'ACTIVO'); // confirmado ACTIVO, sin aviso
        await ciclos('FALLO', 'ACTIVO', 'FALLO', 'ACTIVO', 'FALLO', 'ACTIVO');

        expect(telegram.enviarAvisoCiclo).not.toHaveBeenCalled();
        expect(sendEnlaceCaido).not.toHaveBeenCalled();
        expect(sendEnlaceRecuperado).not.toHaveBeenCalled();
        expect(notifications.encolarEnlaceCaido).not.toHaveBeenCalled();
      });

      it('caída y recuperación se avisan una vez cada una, al leerse igual dos ciclos seguidos', async () => {
        await ciclos('ACTIVO', 'ACTIVO', 'FALLO');
        expect(telegram.enviarAvisoCiclo).not.toHaveBeenCalled();

        await ciclos('FALLO'); // 10 min en FALLO → caída
        expect(telegram.enviarAvisoCiclo).toHaveBeenCalledTimes(1);
        expect(telegram.enviarAvisoCiclo.mock.calls[0][0].nuevos).toEqual(new Set(['978']));

        await ciclos('FALLO', 'ACTIVO');
        expect(telegram.enviarAvisoCiclo).toHaveBeenCalledTimes(1);

        await ciclos('ACTIVO'); // 10 min en ACTIVO → recuperado
        expect(telegram.enviarAvisoCiclo).toHaveBeenCalledTimes(2);
        expect(telegram.enviarAvisoCiclo.mock.calls[1][0].recuperados).toEqual([{ ...recinto, canton: null }]);
      });

      it('vuelve a avisar una caída tras una recuperación confirmada (null→FALLO→ACTIVO→FALLO)', async () => {
        await ciclos('FALLO', 'FALLO'); // nuevo y ya caído: se avisa al confirmarse
        await ciclos('ACTIVO', 'ACTIVO'); // recuperado
        await ciclos('FALLO', 'FALLO'); // cae otra vez

        expect(telegram.enviarAvisoCiclo).toHaveBeenCalledTimes(3);
        expect(sendEnlaceCaido).toHaveBeenCalledTimes(2);
        expect(sendEnlaceRecuperado).toHaveBeenCalledTimes(1);
      });

      describe('intermitentes', () => {
        /** Caídas que el historial tiene del recinto en la última hora (ya con la de este ciclo). */
        const caidasEnLaHora = (n: number) =>
          prisma.enlaceCaida.findMany.mockImplementation(async ({ where }: { where: { inicio?: unknown } }) =>
            where.inicio ? Array.from({ length: n }, () => ({ codigoRecinto: '978' })) : [],
          );

        it('a la 3.ª caída en una hora se avisa una vez, en silencio, como intermitente', async () => {
          await ciclos('ACTIVO', 'ACTIVO', 'FALLO');
          caidasEnLaHora(3);
          await ciclos('FALLO');

          expect(telegram.enviarAvisoCiclo).toHaveBeenCalledTimes(1);
          const aviso = telegram.enviarAvisoCiclo.mock.calls[0][0];
          expect(aviso.nuevos).toEqual(new Set());
          expect(aviso.intermitentes).toEqual([{ ...recinto, canton: null }]);
        });

        it('después de eso, sus caídas ya no generan aviso; su vuelta sí', async () => {
          await ciclos('ACTIVO', 'ACTIVO', 'FALLO');
          caidasEnLaHora(4);
          await ciclos('FALLO');

          expect(telegram.enviarAvisoCiclo).not.toHaveBeenCalled();
          // El correo y la web siguen registrando cada cambio confirmado.
          expect(sendEnlaceCaido).toHaveBeenCalledTimes(1);

          await ciclos('ACTIVO', 'ACTIVO');
          expect(telegram.enviarAvisoCiclo).toHaveBeenCalledTimes(1);
          expect(telegram.enviarAvisoCiclo.mock.calls[0][0].recuperados).toEqual([{ ...recinto, canton: null }]);
        });

        it('la lista del aviso usa el estado confirmado: un recinto que parpadea no aparece y desaparece', async () => {
          const otro = { codigoRecinto: '982', nombreRecinto: 'UE Zaldumbide' };
          // 978 confirmado caído; 982 confirmado ACTIVO pero esta lectura dice FALLO (parpadeo).
          prisma.enlaceRecinto.findUnique.mockImplementation(async ({ where }: { where: { codigoRecinto: string } }) =>
            where.codigoRecinto === '978' ? antes('ACTIVO', 'FALLO') : antes('ACTIVO', 'ACTIVO'),
          );
          sheetsClient.leerEnlacesImbabura.mockResolvedValueOnce([
            { ...recinto, estado: 'FALLO' },
            { ...otro, estado: 'FALLO' },
          ]);
          await service.revisarEnlaces();

          const aviso = telegram.enviarAvisoCiclo.mock.calls[0][0];
          expect(aviso.caidos).toEqual([{ ...recinto, canton: null }]);
          expect(aviso.activos).toEqual([{ ...otro, canton: null }]);
        });

        it('con 2 caídas en la hora todavía es un aviso normal', async () => {
          await ciclos('ACTIVO', 'ACTIVO', 'FALLO');
          caidasEnLaHora(2);
          await ciclos('FALLO');

          expect(telegram.enviarAvisoCiclo.mock.calls[0][0].nuevos).toEqual(new Set(['978']));
        });
      });

      it('el escalamiento sale en el mismo aviso aunque no haya cambios en el ciclo', async () => {
        const grupos = [{ zona: null, recintos: [{ codigoRecinto: '1961', aviso: 2 }] }];
        escalamiento.escalar.mockResolvedValueOnce(grupos);
        await ciclos('FALLO');

        expect(telegram.enviarAvisoCiclo).toHaveBeenCalledTimes(1);
        expect(telegram.enviarAvisoCiclo).toHaveBeenCalledWith(
          expect.objectContaining({ escalamiento: grupos, nuevos: new Set(), recuperados: [] }),
        );
      });
    });

    it('si falla la lectura de la hoja, no toca la tabla ni notifica', async () => {
      sheetsClient.leerEnlacesImbabura.mockRejectedValue(new Error('cuota excedida'));

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.upsert).not.toHaveBeenCalled();
      expect(prisma.enlaceRecinto.deleteMany).not.toHaveBeenCalled();
      expect(telegram.enviarAvisoCiclo).not.toHaveBeenCalled();
    });

    describe('bitácora de revisiones (análisis de datos)', () => {
      it('registra cada ciclo con los conteos de la hoja', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([
          { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
          { codigoRecinto: '982', nombreRecinto: 'UE Zaldumbide', estado: 'FALLO' },
          { codigoRecinto: '990', nombreRecinto: 'UE Otavalo', estado: 'ACTIVO' },
        ]);
        prisma.enlaceRecinto.findUnique.mockResolvedValue({ estado: 'ACTIVO' });
        prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });

        await service.revisarEnlaces();

        expect(prisma.enlaceRevision.create).toHaveBeenCalledTimes(1);
        expect(prisma.enlaceRevision.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ hojaOk: true, historialOk: true, enlaces: 3, activos: 2, caidos: 1, duracionMs: expect.any(Number) }),
        });
      });

      it('si la hoja falla, igual registra el ciclo (sin datos de enlaces) y no toca nada más', async () => {
        sheetsClient.leerEnlacesImbabura.mockRejectedValue(new Error('cuota excedida'));

        await service.revisarEnlaces();

        expect(prisma.enlaceRevision.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ hojaOk: false, historialOk: null, error: 'Error' }),
        });
        expect(prisma.enlaceRecinto.upsert).not.toHaveBeenCalled();
      });

      it('si el historial de caídas falla, lo deja anotado', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' }]);
        prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('FALLO', 'FALLO'));
        prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
        prisma.enlaceCaida.findMany.mockRejectedValueOnce(new Error('base caída'));

        await service.revisarEnlaces();

        expect(prisma.enlaceRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ hojaOk: true, historialOk: false }) });
      });

      it('guarda solo el tipo de error, nunca el mensaje (URLs, id de la hoja, correos)', async () => {
        const e = Object.assign(new Error('403 https://sheets.googleapis.com/v4/spreadsheets/1AbC sa@proyecto.iam.gserviceaccount.com'), {
          code: 403,
        });
        sheetsClient.leerEnlacesImbabura.mockRejectedValue(e);

        await service.revisarEnlaces();

        const guardado = prisma.enlaceRevision.create.mock.calls[0][0].data.error;
        expect(guardado).toBe('Error:403');
        expect(guardado).not.toMatch(/https?:|@|1AbC/);
      });

      it.each([
        [Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), 'Error:ETIMEDOUT'],
        [Object.assign(new Error('x'), { response: { status: 500 } }), 'Error:500'],
        [Object.assign(new TypeError('x'), {}), 'TypeError'],
        ['texto suelto', 'string'],
        [null, 'object'],
        [Object.assign(new Error('x'), { code: 'a b/c?d=1' }), 'Error:abcd1'],
      ])('tipoDeError(%p) → %s', (e, esperado) => {
        expect(tipoDeError(e)).toBe(esperado);
      });

      it('hoja vacía (se leyó, sin filas) se distingue de hoja ilegible', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([]);
        prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });

        await service.revisarEnlaces();

        expect(prisma.enlaceRevision.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ hojaOk: true, enlaces: 0, activos: 0, caidos: 0 }),
        });
      });

      it('si no se puede registrar, el ciclo sigue: escala y avisa igual', async () => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue([{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' }]);
        prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'FALLO'));
        prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
        prisma.enlaceRevision.create.mockRejectedValueOnce(new Error('tabla no existe'));

        await service.revisarEnlaces();

        expect(escalamiento.escalar).toHaveBeenCalled();
        expect(telegram.enviarAvisoCiclo).toHaveBeenCalled();
      });

      it('con ENLACES_CRON_ENABLED=false no registra nada (no hubo revisión)', async () => {
        process.env.ENLACES_CRON_ENABLED = 'false';
        await service.revisarEnlaces();
        expect(prisma.enlaceRevision.create).not.toHaveBeenCalled();
      });
    });

    it('si el ciclo anterior sigue en curso, el siguiente se salta (no avisa dos veces)', async () => {
      let soltar: (v: unknown) => void = () => {};
      sheetsClient.leerEnlacesImbabura.mockImplementationOnce(() => new Promise((r) => (soltar = r)));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });

      const primero = service.revisarEnlaces();
      await Promise.resolve();
      await service.revisarEnlaces();
      expect(sheetsClient.leerEnlacesImbabura).toHaveBeenCalledTimes(1);
      // El ciclo saltado no escribe nada.
      expect(prisma.enlaceRevision.create).not.toHaveBeenCalled();
      expect(prisma.enlaceRecinto.upsert).not.toHaveBeenCalled();

      soltar([]);
      await primero;
      // Terminado el primero, el candado se suelta y el siguiente ciclo corre.
      sheetsClient.leerEnlacesImbabura.mockResolvedValueOnce([]);
      await service.revisarEnlaces();
      expect(sheetsClient.leerEnlacesImbabura).toHaveBeenCalledTimes(2);
    });

    it('si un ciclo revienta, el candado se suelta igual', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValueOnce([]);
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      escalamiento.escalar.mockRejectedValueOnce(new Error('Telegram caído'));

      await expect(service.revisarEnlaces()).rejects.toThrow('Telegram caído');
      sheetsClient.leerEnlacesImbabura.mockResolvedValueOnce([]);
      await service.revisarEnlaces();

      expect(sheetsClient.leerEnlacesImbabura).toHaveBeenCalledTimes(2);
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

      /** La hoja de este ciclo; cada recinto ya se leía igual y quedó confirmado así
       * (el historial sigue el estado confirmado, ver evaluarLectura). */
      const leer = (...filas: ReturnType<typeof fila>[]) => {
        sheetsClient.leerEnlacesImbabura.mockResolvedValue(filas);
        prisma.enlaceRecinto.findUnique.mockImplementation(async ({ where }: { where: { codigoRecinto: string } }) => {
          const f = filas.find((x) => x.codigoRecinto === where.codigoRecinto);
          return f ? antes(f.estado as 'ACTIVO' | 'FALLO', f.estado as 'ACTIVO' | 'FALLO') : null;
        });
      };

      beforeEach(() => {
        prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
        prisma.enlaceCaida.findMany.mockResolvedValue([]);
      });

      afterEach(() => prisma.enlaceRecinto.findUnique.mockReset());

      it('abre una caída para cada recinto en FALLO que no tenga una abierta', async () => {
        leer(fila('978', 'FALLO'), fila('982', 'FALLO'), fila('28', 'ACTIVO'));
        prisma.enlaceCaida.findMany.mockResolvedValue([{ codigoRecinto: '982', inicio: new Date() }]);

        await service.revisarEnlaces();

        expect(prisma.enlaceCaida.findMany).toHaveBeenCalledWith({ where: { fin: null }, select: { codigoRecinto: true, inicio: true } });
        expect(prisma.enlaceCaida.createMany).toHaveBeenCalledWith({
          data: [{ codigoRecinto: '978', nombreRecinto: 'Recinto 978', canton: 'Ibarra', inicio: expect.any(Date) }],
          skipDuplicates: true,
        });
      });

      it('cierra las caídas abiertas de los recintos que están ACTIVO', async () => {
        leer(fila('978', 'ACTIVO'), fila('28', 'ACTIVO'));
        prisma.enlaceCaida.findMany.mockResolvedValue([{ codigoRecinto: '978', inicio: new Date() }]);

        await service.revisarEnlaces();

        expect(prisma.enlaceCaida.updateMany).toHaveBeenCalledWith({
          where: { codigoRecinto: { in: ['978', '28'] }, fin: null },
          data: { fin: expect.any(Date) },
        });
        expect(prisma.enlaceCaida.createMany).not.toHaveBeenCalled();
      });

      it('al recuperarse, Telegram dice cuánto duró la caída', async () => {
        leer(fila('978', 'ACTIVO'));
        prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('FALLO', 'ACTIVO'));
        prisma.enlaceCaida.findMany.mockResolvedValue([
          { codigoRecinto: '978', inicio: new Date(Date.now() - 42 * 60_000) },
        ]);

        await service.revisarEnlaces();

        const { minutosCaido: minutos } = telegram.enviarAvisoCiclo.mock.calls[0][0];
        expect(minutos.get('978')).toBe(42);
      });

      it('si el historial no se pudo actualizar, no escala (podría avisar de un enlace que ya volvió)', async () => {
        leer(fila('978', 'FALLO'));
        prisma.enlaceCaida.findMany.mockRejectedValueOnce(new Error('base caída'));

        await service.revisarEnlaces();

        expect(escalamiento.escalar).not.toHaveBeenCalled();
      });

      it('cada ciclo revisa el escalamiento (avisos de 30 min), después del historial', async () => {
        leer(fila('978', 'FALLO'));

        await service.revisarEnlaces();

        expect(escalamiento.escalar).toHaveBeenCalledTimes(1);
        expect(prisma.enlaceCaida.createMany.mock.invocationCallOrder[0]).toBeLessThan(
          escalamiento.escalar.mock.invocationCallOrder[0],
        );
      });

      it('sin cambios no escribe nada (FALLO con caída abierta, ACTIVO sin abierta)', async () => {
        leer(fila('978', 'FALLO'), fila('28', 'ACTIVO'));
        prisma.enlaceCaida.findMany.mockResolvedValue([{ codigoRecinto: '978', inicio: new Date() }]);

        await service.revisarEnlaces();

        expect(prisma.enlaceCaida.createMany).not.toHaveBeenCalled();
        expect(prisma.enlaceCaida.updateMany).not.toHaveBeenCalled();
      });

      it('un parpadeo no abre ni cierra caídas: el historial sigue lo confirmado', async () => {
        leer(fila('978', 'ACTIVO'));
        // Confirmado en FALLO; esta lectura en ACTIVO todavía no se confirma.
        prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('FALLO', 'FALLO'));
        prisma.enlaceCaida.findMany.mockResolvedValue([{ codigoRecinto: '978', inicio: new Date() }]);

        await service.revisarEnlaces();

        expect(prisma.enlaceCaida.updateMany).not.toHaveBeenCalled();
        expect(prisma.enlaceCaida.createMany).not.toHaveBeenCalled();
      });

      it('si un ciclo no pudo cerrar la caída, el siguiente la cierra igual (ACTIVO→ACTIVO)', async () => {
        leer(fila('978', 'ACTIVO'));
        prisma.enlaceCaida.findMany.mockResolvedValue([{ codigoRecinto: '978', inicio: new Date() }]);

        await service.revisarEnlaces();

        expect(prisma.enlaceCaida.updateMany).toHaveBeenCalled();
      });

      it('si un ciclo no pudo abrirla, el siguiente la abre igual (FALLO→FALLO) sin volver a avisar', async () => {
        leer(fila('978', 'FALLO'));

        await service.revisarEnlaces();

        expect(prisma.enlaceCaida.createMany).toHaveBeenCalled();
        expect(telegram.enviarAvisoCiclo).not.toHaveBeenCalled();
      });

      it('un error de la base en el historial no frena los avisos del ciclo', async () => {
        leer(fila('978', 'FALLO'));
        prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'FALLO'));
        prisma.enlaceCaida.findMany.mockRejectedValueOnce(new Error('conexión perdida'));

        await expect(service.revisarEnlaces()).resolves.toBeUndefined();

        expect(telegram.enviarAvisoCiclo).toHaveBeenCalled();
        expect(notifications.encolarEnlaceCaido).toHaveBeenCalled();
      });

      it('los recintos que salen de la hoja cierran su caída abierta', async () => {
        leer(fila('978', 'ACTIVO'));
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
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'FALLO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });
      prisma.enlaceRecinto.count.mockRejectedValueOnce(new Error('timeout de base'));

      await expect(service.revisarEnlaces()).resolves.toBeUndefined();

      expect(telegram.enviarAvisoCiclo).toHaveBeenCalled();
      expect(sendEnlaceCaido).toHaveBeenCalled();
    });

    it('un fallo en Telegram no impide encolar el aviso in-app', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'FALLO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      telegram.enviarAvisoCiclo.mockRejectedValueOnce(new Error('telegram caído'));

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
      prisma.enlaceRecinto.findUnique.mockResolvedValueOnce(antes('ACTIVO', 'FALLO'));
      prisma.enlaceRecinto.upsert.mockRejectedValueOnce(new Error('violates constraint'));
      prisma.enlaceRecinto.findUnique.mockResolvedValueOnce(antes('ACTIVO', 'FALLO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      await expect(service.revisarEnlaces()).resolves.toBeUndefined();

      expect(telegram.enviarAvisoCiclo).toHaveBeenCalledTimes(1);
      expect(telegram.enviarAvisoCiclo).toHaveBeenCalledWith(
        expect.objectContaining({
          caidos: [
          { codigoRecinto: '978', nombreRecinto: 'Escuela Rota', canton: null },
          { codigoRecinto: '982', nombreRecinto: 'Escuela Sana', canton: null },
        ],
          nuevos: new Set(['982']),
          contactos: expect.any(Map),
          activos: [],
        }),
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
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('FALLO', 'ACTIVO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      await service.revisarEnlaces();

      expect(sendEnlaceRecuperado).toHaveBeenCalledWith(
        ['a@b.com'],
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null }],
      );
      expect(telegram.enviarAvisoCiclo).toHaveBeenCalledWith(
        expect.objectContaining({
          recuperados: [
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null },
          ],
          minutosCaido: expect.any(Map),
        }),
      );
    });

    it('NO notifica recuperación si el enlace sigue ACTIVO (no venía de FALLO)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('ACTIVO', 'ACTIVO'));

      await service.revisarEnlaces();

      expect(sendEnlaceRecuperado).not.toHaveBeenCalled();
      expect(telegram.enviarAvisoCiclo).not.toHaveBeenCalled();
    });

    it('NO notifica recuperación en la primera carga de un enlace ya ACTIVO (sin estado anterior)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(null);

      await service.revisarEnlaces();

      expect(sendEnlaceRecuperado).not.toHaveBeenCalled();
      expect(telegram.enviarAvisoCiclo).not.toHaveBeenCalled();
    });

    it('no envía correo de recuperación si nadie está registrado, aunque sí notifica Telegram', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('FALLO', 'ACTIVO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });

      await service.revisarEnlaces();

      expect(sendEnlaceRecuperado).not.toHaveBeenCalled();
      expect(telegram.enviarAvisoCiclo).toHaveBeenCalledWith(
        expect.objectContaining({
          recuperados: [
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null },
          ],
          minutosCaido: expect.any(Map),
        }),
      );
    });

    it('un fallo en el correo o Telegram de recuperación no interrumpe el ciclo', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'ACTIVO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(antes('FALLO', 'ACTIVO'));
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });
      sendEnlaceRecuperado.mockRejectedValueOnce(new Error('Brevo caído'));
      telegram.enviarAvisoCiclo.mockRejectedValueOnce(new Error('telegram caído'));

      await expect(service.revisarEnlaces()).resolves.toBeUndefined();
    });

    it('agrupa caídas y recuperaciones del mismo ciclo en sus respectivas notificaciones', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '111', nombreRecinto: 'Se recupera', estado: 'ACTIVO' },
        { codigoRecinto: '222', nombreRecinto: 'Recién cae', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique
        .mockResolvedValueOnce(antes('FALLO', 'ACTIVO')) // 111 se recupera
        .mockResolvedValueOnce(antes('ACTIVO', 'FALLO')); // 222 acaba de caer
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

      await expect(service.getConfig()).resolves.toEqual({
        correos: [],
        minutosPrimerAviso: 10,
        minutosRepetirAviso: 30,
        minutosResumenJornada: 15,
      });
    });

    it('guardarResumenJornada guarda la frecuencia del resumen y devuelve la config completa', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [], minutosPrimerAviso: 120, minutosRepetirAviso: 120, minutosResumenJornada: 30 });

      const result = await service.guardarResumenJornada({ minutosResumenJornada: 30 });

      expect(jornada.guardarMinutosResumen).toHaveBeenCalledWith(30);
      expect(result.minutosResumenJornada).toBe(30);
    });

    it('sin configuración guardada, getConfig devuelve 2 h y 2 h', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue(null);

      await expect(service.getConfig()).resolves.toEqual({
        correos: [],
        minutosPrimerAviso: 120,
        minutosRepetirAviso: 120,
        minutosResumenJornada: 15,
      });
    });

    it('guardarAvisos guarda solo la frecuencia (no toca los correos) y devuelve la config completa', async () => {
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: ['a@b.com'], minutosPrimerAviso: 10, minutosRepetirAviso: 10 });

      const result = await service.guardarAvisos({ minutosPrimerAviso: 10, minutosRepetirAviso: 10 });

      expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith({
        where: { id: 1 },
        create: { id: 1, minutosPrimerAviso: 10, minutosRepetirAviso: 10 },
        update: { minutosPrimerAviso: 10, minutosRepetirAviso: 10 },
      });
      expect(result).toEqual({ correos: ['a@b.com'], minutosPrimerAviso: 10, minutosRepetirAviso: 10, minutosResumenJornada: 15 });
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

      expect(prisma.enlaceRecinto.findMany).toHaveBeenCalledWith({ where: { estado: { in: ['FALLO', 'ACTIVO'] } } });
      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [
          { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null },
          { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', canton: null },
        ],
        undefined,
        undefined,
        undefined,
        [],
      );
      expect(result).toEqual({ enviados: 2 });
    });

    it('pasa el cantón de cada recinto para que Telegram lo muestre abreviado', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        { codigoRecinto: '1207', nombreRecinto: 'Escuela Guallupe', canton: 'Cotacachi', estado: 'FALLO' },
      ]);

      await service.reenviarListaTelegram();

      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [
          { codigoRecinto: '1207', nombreRecinto: 'Escuela Guallupe', canton: 'Cotacachi' },
        ],
        undefined,
        undefined,
        undefined,
        [],
      );
    });

    it('pasa también los activos, para el aviso de "casi todo caído"; enviados cuenta solo los caídos', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: 'Ibarra', estado: 'FALLO' },
        { codigoRecinto: '1207', nombreRecinto: 'UE Ibarra', canton: 'Ibarra', estado: 'ACTIVO' },
      ]);

      const result = await service.reenviarListaTelegram();

      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: 'Ibarra' }],
        undefined,
        undefined,
        undefined,
        [{ codigoRecinto: '1207', nombreRecinto: 'UE Ibarra', canton: 'Ibarra' }],
      );
      expect(result).toEqual({ enviados: 1 });
    });

    it('sin recintos en FALLO igual llama al notifier (avisa "sin caídos") y devuelve 0', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue([]);

      const result = await service.reenviarListaTelegram();

      expect(telegram.enviarListaActual).toHaveBeenCalledWith([], undefined, undefined, undefined, []);
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

      expect(prisma.enlaceRecinto.findMany).toHaveBeenCalledWith({ where: { estado: { in: ['FALLO', 'ACTIVO'] } } });
      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [
          { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null },
        ],
        undefined,
        undefined,
        undefined,
        [],
      );
    });

    describe('grupo Jornada', () => {
      beforeEach(() => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
      });

      it('un mensaje que atiende la Jornada no pasa al bot de enlaces', async () => {
        jornada.atenderMensaje.mockResolvedValueOnce(true);
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '🚐 Salida DPEI', chat: { id: '-100999' } },
        });
        expect(jornada.atenderMensaje).toHaveBeenCalledWith('-100999', '🚐 Salida DPEI', undefined);
        expect(telegram.enviarListaActual).not.toHaveBeenCalled();
      });

      it('un administrador anónimo (a nombre del grupo) llega a la Jornada sin remitente', async () => {
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '971', chat: { id: '-100999' }, from: { id: 1087968824, is_bot: true }, sender_chat: { id: '-100999' } },
        });
        expect(jornada.atenderMensaje).toHaveBeenCalledWith('-100999', '971', undefined);

        await service.procesarComandoTelegram('secreto123', {
          message: { text: '971', chat: { id: '-100999' }, from: { id: 55 } },
        });
        expect(jornada.atenderMensaje).toHaveBeenLastCalledWith('-100999', '971', 55);
      });

      it('si la Jornada no lo atiende, el bot de enlaces sigue igual', async () => {
        prisma.enlaceRecinto.findMany.mockResolvedValue([]);
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '/caidos', chat: { id: '-100200300' } },
        });
        expect(jornada.atenderMensaje).toHaveBeenCalled();
        expect(telegram.enviarListaActual).toHaveBeenCalled();
      });

      it('un botón de la Jornada se le pasa con chat, id, data, mensaje y quién lo tocó', async () => {
        jornada.atenderBoton.mockResolvedValueOnce(true);
        await service.procesarComandoTelegram('secreto123', {
          callback_query: { id: 'cb1', data: 'jor:sd:2:0', message: { message_id: 7, chat: { id: '-100999' } }, from: { id: 111 } },
        });
        expect(jornada.atenderBoton).toHaveBeenCalledWith('-100999', 'cb1', 'jor:sd:2:0', 7, 111);
        expect(telegram.responderBoton).not.toHaveBeenCalled();
      });

      it('con el secreto inválido no llega nada a la Jornada', async () => {
        await service.procesarComandoTelegram('otro', {
          message: { text: '🚐 Salida DPEI', chat: { id: '-100999' } },
        });
        expect(jornada.atenderMensaje).not.toHaveBeenCalled();
      });
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

      expect(telegram.enviarListaActual).toHaveBeenCalledWith(
        [
          { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: null },
        ],
        undefined,
        undefined,
        undefined,
        [],
      );
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
        expect(telegram.enviarHtml).toHaveBeenLastCalledWith(expect.stringContaining('Escuela Central'), expect.any(String));
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
            { provide: JornadaService, useValue: jornada },
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

    describe('botón de un técnico (tablero o aviso)', () => {
      const boton = (data: string) => ({
        callback_query: { id: 'cb-p', data, message: { message_id: 77, chat: { id: '-100200300' } } },
      });

      beforeEach(() => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        distributivo.asignaciones.mockResolvedValue([
          { codigoRecinto: '982', localidad: '', parroquia: '', numeroTecnico: 1, tecnico: 'Jairo Leal' },
          { codigoRecinto: '1', localidad: '', parroquia: '', numeroTecnico: 1, tecnico: 'Jairo Leal' },
        ]);
        prisma.enlaceRecinto.findMany.mockResolvedValue([
          // Lectura en ACTIVO pero confirmado en FALLO: cuenta como pendiente (no parpadea).
          { codigoRecinto: '982', nombreRecinto: 'UE Zaldumbide', canton: 'Ibarra', estado: 'ACTIVO', estadoConfirmado: 'FALLO' },
          { codigoRecinto: '1', nombreRecinto: 'Escuela', canton: 'Ibarra', estado: 'ACTIVO', estadoConfirmado: 'ACTIVO' },
        ]);
        encargados.encargados.mockResolvedValue(new Map([['982', { nombre: 'Danilo', telefono: '0968' }]]));
      });

      it('"pend:1" contesta el toque y manda los pendientes de ese técnico con su estado confirmado', async () => {
        await service.procesarComandoTelegram('secreto123', boton('pend:1'));

        expect(telegram.responderBoton).toHaveBeenCalledWith('cb-p');
        const [grupo, contactos] = telegram.enviarPendientesTecnico.mock.calls[0];
        expect(grupo.tecnico).toBe('Jairo Leal');
        expect(grupo.recintos.find((r: { codigoRecinto: string }) => r.codigoRecinto === '982').estado).toBe('FALLO');
        expect(contactos.get('982')).toEqual({ nombre: 'Danilo', telefono: '0968' });
      });

      it('un técnico que ya no está en el distributivo: lo dice', async () => {
        await service.procesarComandoTelegram('secreto123', boton('pend:9'));

        expect(telegram.enviarPendientesTecnico).not.toHaveBeenCalled();
        expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringContaining('ya no figura'), expect.any(String));
      });

      it.each(['pend:0', 'pend:1 OR 1', 'pend:abc'])('un callback mal formado (%s) se ignora', async (data) => {
        await service.procesarComandoTelegram('secreto123', boton(data));

        expect(telegram.enviarPendientesTecnico).not.toHaveBeenCalled();
      });

      it('si Drive falla, avisa en vez de callar', async () => {
        distributivo.asignaciones.mockRejectedValue(new Error('Drive caído'));

        await service.procesarComandoTelegram('secreto123', boton('pend:1'));

        expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringContaining('⚠️'), expect.any(String));
      });
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
        expect(telegram.enviarHtml).toHaveBeenLastCalledWith(
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

        expect(telegram.enviarHtml).toHaveBeenLastCalledWith(
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

          expect(telegram.enviarHtml).toHaveBeenLastCalledWith(
            expect.stringContaining('📍 CPE — CPE - IMBABURA'),
            expect.any(String),
          );
        },
      );

      it('agrega el técnico asignado y a quién llamar en el recinto', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        prisma.enlaceRecinto.findUnique.mockResolvedValue({
          codigoRecinto: '978',
          nombreRecinto: 'Escuela Central',
          canton: 'Ibarra',
          estado: 'ACTIVO',
        });
        distributivo.asignaciones.mockResolvedValue([
          { codigoRecinto: '978', localidad: '', parroquia: '', numeroTecnico: 1, tecnico: 'Ana Pérez' },
        ]);
        encargados.encargados.mockResolvedValue(
          new Map([['978', { nombre: 'Juana Ejemplo', telefono: '0990000000' }]]),
        );

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '978', chat: { id: '-100200300' }, from: { id: 111 } },
        });

        const [texto] = telegram.enviarHtml.mock.calls.at(-1);
        expect(texto).toContain('👷 Técnico: Ana Pérez');
        expect(texto).toContain('📞 Llamar: Juana Ejemplo · 0990000000');
      });

      it('responde el estado aunque no se puedan leer el distributivo ni los encargados', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        prisma.enlaceRecinto.findUnique.mockResolvedValue({
          codigoRecinto: '978',
          nombreRecinto: 'Escuela Central',
          canton: 'Ibarra',
          estado: 'FALLO',
        });
        distributivo.asignaciones.mockRejectedValue(new Error('Drive caído'));
        encargados.encargados.mockRejectedValue(new Error('Drive caído'));

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '978', chat: { id: '-100200300' }, from: { id: 111 } },
        });

        const [texto] = telegram.enviarHtml.mock.calls.at(-1);
        expect(texto).toContain('Estado: 🔴 FALLO');
        expect(texto).toContain('👷 Técnico: sin asignar');
        expect(texto).toContain('📞 Llamar: sin registrar');
      });

      it('si falla solo el distributivo, igual muestra a quién llamar', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        prisma.enlaceRecinto.findUnique.mockResolvedValue({
          codigoRecinto: '978',
          nombreRecinto: 'Escuela Central',
          canton: 'Ibarra',
          estado: 'ACTIVO',
        });
        distributivo.asignaciones.mockRejectedValue(new Error('Drive caído'));
        encargados.encargados.mockResolvedValue(new Map([['978', { nombre: 'Juana Ejemplo', telefono: '' }]]));

        await service.procesarComandoTelegram('secreto123', {
          message: { text: TEXTO_BOTON_INGRESAR_CODIGO, chat: { id: '-100200300' }, from: { id: 111 } },
        });
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '978', chat: { id: '-100200300' }, from: { id: 111 } },
        });

        const [texto] = telegram.enviarHtml.mock.calls.at(-1);
        expect(texto).toContain('👷 Técnico: sin asignar');
        expect(texto).toContain('📞 Llamar: Juana Ejemplo');
        expect(texto).not.toContain('Juana Ejemplo ·');
      });

      it('avisa si el código no existe, en vez de quedarse callado', async () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
        process.env.TELEGRAM_CHAT_ID = '-100200300';
        prisma.enlaceRecinto.findUnique.mockResolvedValue(null);
        prisma.enlaceRecinto.findMany.mockResolvedValue([]);

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

      describe('"Buscar recinto": por código o por nombre, sin importar mayúsculas ni tildes', () => {
        const RECINTOS = [
          { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: 'Ibarra', estado: 'ACTIVO' },
          { codigoRecinto: '1008', nombreRecinto: 'Unidad Educativa Ilumán', canton: 'Otavalo', estado: 'FALLO' },
          { codigoRecinto: '1290', nombreRecinto: 'Colegio Nacional Ibarra', canton: 'Ibarra', estado: 'ACTIVO' },
          { codigoRecinto: '1487', nombreRecinto: 'Escuela Ibarra Norte', canton: 'Ibarra', estado: 'ACTIVO' },
          { codigoRecinto: 'CPE', nombreRecinto: 'CPE - IMBABURA', canton: null, estado: 'ACTIVO' },
        ];
        const buscar = async (texto: string, boton = TEXTO_BOTON_BUSCAR_RECINTO) => {
          await service.procesarComandoTelegram('secreto123', {
            message: { text: boton, chat: { id: '-100200300' }, from: { id: 111 } },
          });
          await service.procesarComandoTelegram('secreto123', {
            message: { text: texto, chat: { id: '-100200300' }, from: { id: 111 } },
          });
        };

        beforeEach(() => {
          process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
          process.env.TELEGRAM_CHAT_ID = '-100200300';
          prisma.enlaceRecinto.findMany.mockResolvedValue(RECINTOS);
          prisma.enlaceRecinto.findUnique.mockImplementation(({ where }: { where: { codigoRecinto: string } }) =>
            Promise.resolve(RECINTOS.find((r) => r.codigoRecinto === where.codigoRecinto) ?? null),
          );
        });

        it('el botón dice "Buscar recinto" y pide el código o el nombre', async () => {
          expect(TEXTO_BOTON_BUSCAR_RECINTO).toBe('🔍 Buscar recinto');
          await service.procesarComandoTelegram('secreto123', {
            message: { text: TEXTO_BOTON_BUSCAR_RECINTO, chat: { id: '-100200300' }, from: { id: 111 } },
          });
          expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringMatching(/código o el nombre/i), expect.any(String));
        });

        it.each([['iluman'], ['ILUMÁN'], ['unidad educativa ilumán'], ['Ilu']])(
          '"%s" encuentra el recinto por nombre y manda la misma ficha que con el código',
          async (texto) => {
            await buscar(texto);
            const [ficha] = telegram.enviarHtml.mock.calls.at(-1);
            expect(ficha).toContain('📍 1008 (Ota) — Unidad Educativa Ilumán');
            expect(ficha).toContain('Estado: 🔴 FALLO');
          },
        );

        describe('NO CDA (no tienen enlace: se buscan en los recintos)', () => {
          const NO_CDA_5968 = {
            codigoRecinto: '5968',
            nombre: 'UECIB Manuel J Calle Bloque 3',
            parroquia: 'EUGENIO ESPEJO',
            canton: { nombre: 'OTAVALO' },
          };
          beforeEach(() => {
            prisma.recinto.findMany.mockResolvedValue([NO_CDA_5968]);
            prisma.recinto.findFirst.mockImplementation(({ where }: { where: { codigoRecinto: string } }) =>
              Promise.resolve(
                where.codigoRecinto === '5968'
                  ? { codigoRecinto: '5968', nombre: NO_CDA_5968.nombre, cdaDestino: { codigoRecinto: '1008', nombre: 'Unidad Educativa Ilumán' } }
                  : null,
              ),
            );
          });

          it('por código: dice a qué CDA entrega y manda la ficha de ese CDA', async () => {
            await buscar('5968');
            const textos = telegram.enviarHtml.mock.calls.map(([t]) => t);
            expect(textos.at(-2)).toBe(
              '🏫 <b>5968 · UECIB Manuel J Calle Bloque 3</b> es un NO CDA: entrega en el CDA <b>1008 · Unidad Educativa Ilumán</b>.',
            );
            expect(textos.at(-1)).toContain('📍 1008 (Ota) — Unidad Educativa Ilumán');
            expect(prisma.recinto.findMany).toHaveBeenCalledWith(
              expect.objectContaining({ where: { tipo: 'NO_CDA', activo: true } }),
            );
          });

          it('por nombre: si coincide con un CDA y un NO CDA ofrece los dos, marcando el NO CDA', async () => {
            prisma.recinto.findMany.mockResolvedValue([{ ...NO_CDA_5968, nombre: 'Escuela Ilumán Bloque 4' }]);
            await buscar('iluman');
            const [, , botones] = telegram.enviarHtml.mock.calls.at(-1);
            const textos = (botones as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat().map((b) => b.text);
            expect(textos).toEqual(expect.arrayContaining(['5968 · Escuela Ilumán Bloque 4 (NO CDA)']));
            expect(textos.some((t) => t.startsWith('1008 · '))).toBe(true);
          });

          it('el botón de un NO CDA (rec:5968) también lleva a su CDA', async () => {
            await service.procesarComandoTelegram('secreto123', {
              callback_query: { id: 'cb', data: 'rec:5968', message: { message_id: 3, chat: { id: '-100200300' } } },
            });
            expect(telegram.enviarHtml.mock.calls.at(-2)[0]).toContain('es un NO CDA: entrega en el CDA');
          });

          it('un NO CDA sin CDA destino dice que va directo a la Delegación', async () => {
            prisma.recinto.findFirst.mockResolvedValue({ codigoRecinto: '1963', nombre: 'Piñán', cdaDestino: null });
            prisma.recinto.findMany.mockResolvedValue([{ ...NO_CDA_5968, codigoRecinto: '1963', nombre: 'Piñán' }]);
            await buscar('1963');
            expect(telegram.enviarHtml.mock.calls.at(-1)[0]).toContain('va directo a la Delegación');
          });
        });

        it('el código exacto gana y no recorre la lista de recintos', async () => {
          await buscar('1290');
          expect(prisma.enlaceRecinto.findMany).not.toHaveBeenCalled();
          expect(telegram.enviarHtml.mock.calls.at(-1)[0]).toContain('📍 1290 (Iba) — Colegio Nacional Ibarra');
        });

        it('un texto muy largo se recorta antes de buscar y de repetirlo', async () => {
          await buscar('zzzz '.repeat(400));
          const [texto] = telegram.enviarTexto.mock.calls.at(-1);
          expect(texto).toMatch(/no se encontró/i);
          expect(texto.length).toBeLessThan(200);
        });

        it('el código en minúsculas también vale ("cpe")', async () => {
          await buscar('cpe');
          expect(telegram.enviarHtml.mock.calls.at(-1)[0]).toContain('📍 CPE — CPE - IMBABURA');
        });

        it('el botón viejo "Ingresar código" (teclados anteriores) busca igual', async () => {
          await buscar('iluman', TEXTO_BOTON_INGRESAR_CODIGO);
          expect(telegram.enviarHtml.mock.calls.at(-1)[0]).toContain('Unidad Educativa Ilumán');
        });

        it('varios recintos: un botón por recinto para elegir', async () => {
          await buscar('ibarra');
          const [texto, , botones] = telegram.enviarHtml.mock.calls.at(-1);
          expect(texto).toContain('Encontré 2 recintos para "ibarra"');
          expect(botones).toEqual({
            inline_keyboard: [
              [{ text: '1290 · Colegio Nacional Ibarra', callback_data: 'rec:1290' }],
              [{ text: '1487 · Escuela Ibarra Norte', callback_data: 'rec:1487' }],
            ],
          });
        });

        it('al tocar un recinto de la lista, manda su ficha', async () => {
          await service.procesarComandoTelegram('secreto123', {
            callback_query: { id: 'cb-r', data: 'rec:1290', message: { message_id: 90, chat: { id: '-100200300' } } },
          });
          expect(telegram.responderBoton).toHaveBeenCalledWith('cb-r');
          expect(telegram.enviarHtml.mock.calls.at(-1)[0]).toContain('📍 1290 (Iba) — Colegio Nacional Ibarra');
        });

        it('un botón con datos que no son un código se ignora sin consultar', async () => {
          await service.procesarComandoTelegram('secreto123', {
            callback_query: { id: 'cb-x', data: 'rec:1 OR 1', message: { message_id: 91, chat: { id: '-100200300' } } },
          });
          expect(prisma.enlaceRecinto.findUnique).not.toHaveBeenCalled();
        });

        it('un botón de un recinto que ya no existe lo dice', async () => {
          await service.procesarComandoTelegram('secreto123', {
            callback_query: { id: 'cb-y', data: 'rec:9999', message: { message_id: 92, chat: { id: '-100200300' } } },
          });
          expect(telegram.enviarTexto.mock.calls.at(-1)[0]).toMatch(/no se encontró/i);
        });

        it('los botones del asistente (asis:rec:) siguen yendo al asistente', async () => {
          await service.procesarComandoTelegram('secreto123', {
            callback_query: { id: 'cb-z', data: 'asis:rec:1008', message: { message_id: 93, chat: { id: '-100200300' } } },
          });
          expect(asistente.responderRecintoElegido).toHaveBeenCalledWith('1008');
          expect(prisma.enlaceRecinto.findUnique).not.toHaveBeenCalled();
        });

        it('más de 8 resultados: solo 8 botones y pide más detalle', async () => {
          prisma.enlaceRecinto.findMany.mockResolvedValue(
            Array.from({ length: 12 }, (_, i) => ({
              codigoRecinto: String(2000 + i),
              nombreRecinto: `Escuela Mira ${i}`,
              canton: 'Mira',
              estado: 'ACTIVO',
            })),
          );
          await buscar('escuela mira');
          const [texto, , botones] = telegram.enviarHtml.mock.calls.at(-1);
          expect(botones.inline_keyboard).toHaveLength(8);
          expect(texto).toContain('12 recintos');
          expect(texto).toMatch(/más detalle/i);
        });

        it('lo escrito con < o & se escapa en la lista y va en texto plano si no hay resultados', async () => {
          await buscar('ibarra <b>');
          expect(telegram.enviarHtml).not.toHaveBeenCalled();
          expect(telegram.enviarTexto.mock.calls.at(-1)[0]).toContain('"ibarra <b>"');

          prisma.enlaceRecinto.findMany.mockResolvedValue([
            { codigoRecinto: '1', nombreRecinto: 'Mariano Suárez & Hijos', canton: 'Ibarra', estado: 'ACTIVO' },
            { codigoRecinto: '2', nombreRecinto: 'Mariano Acosta & Cía', canton: 'Ibarra', estado: 'ACTIVO' },
          ]);
          await buscar('mariano &');
          expect(telegram.enviarHtml.mock.calls.at(-1)[0]).toContain('"mariano &amp;"');
        });

        it('sin coincidencias: lo dice, no se queda callado', async () => {
          await buscar('zzzz qqqq');
          const ultimo = [...telegram.enviarTexto.mock.calls, ...telegram.enviarHtml.mock.calls].map((c) => c[0]).join('\n');
          expect(ultimo).toMatch(/no se encontró/i);
        });
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
        expect(telegram.enviarHtml).toHaveBeenLastCalledWith(
          expect.stringContaining('Escuela Central'),
          expect.any(String),
        );

        // B manda el suyo después: se resuelve con su propio código, no con el de A.
        await service.procesarComandoTelegram('secreto123', {
          message: { text: '982', chat: { id: '-100200300' }, from: { id: 222 } },
        });
        expect(telegram.enviarHtml).toHaveBeenLastCalledWith(
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
        expect(telegram.enviarHtml).toHaveBeenLastCalledWith(
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
