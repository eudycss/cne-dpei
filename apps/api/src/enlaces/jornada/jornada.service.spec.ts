import { Test } from '@nestjs/testing';
import { PrismaService } from '../../db/prisma.service';
import { DistributivoNoConfigurado, DistributivoTecnicosClient } from '../distributivo-tecnicos.client';
import { TelegramNotifier } from '../telegram-notifier';
import { BOTONES_JORNADA } from './jornada';
import { JornadaService, diaDeJornada, esChatJornada } from './jornada.service';

const CHAT = '-100777';
const T = (iso: string) => new Date(iso);

describe('JornadaService', () => {
  let service: JornadaService;

  const prisma = {
    eventoElectoral: { findFirst: jest.fn() },
    kitElectoral: { findMany: jest.fn() },
    recinto: { findMany: jest.fn() },
    parejaCda: { findMany: jest.fn() },
    eventoTracking: { findMany: jest.fn() },
    recepcionDpiKit: { findMany: jest.fn() },
  };
  const distributivo = { asignaciones: jest.fn() };
  const telegram = {
    enviarHtml: jest.fn().mockResolvedValue(undefined),
    editarHtml: jest.fn().mockResolvedValue(undefined),
    responderBoton: jest.fn().mockResolvedValue(undefined),
    responderEn: jest.fn((_chat: string, fn: () => Promise<unknown>) => fn()),
  };

  /** Dos kits: 971 (Jairo, con pareja, salió del DPEI) y 1487 (Carlos, sin pareja). Un CDA sin kit. */
  function datosBase() {
    prisma.eventoElectoral.findFirst.mockResolvedValue({ id: 'ev1', nombre: 'Elecciones 2027' });
    prisma.kitElectoral.findMany.mockResolvedValue([
      {
        id: 'k1',
        operadorId: 'u1',
        recinto: { id: 'r1', codigoRecinto: '971', nombre: 'UE Chaltura' },
        operador: { nombres: 'Ana', apellidos: 'Pérez', telefono: '0990000001' },
      },
      {
        id: 'k2',
        operadorId: 'u2',
        recinto: { id: 'r2', codigoRecinto: '1487', nombre: 'UE Apuela' },
        operador: { nombres: 'Luis', apellidos: 'Mora', telefono: null },
      },
    ]);
    prisma.recinto.findMany.mockImplementation(({ where }: { where: { tipo: string } }) =>
      Promise.resolve(
        where.tipo === 'CDA'
          ? [
              { id: 'r1', codigoRecinto: '971', nombre: 'UE Chaltura' },
              { id: 'r2', codigoRecinto: '1487', nombre: 'UE Apuela' },
              { id: 'r3', codigoRecinto: '1500', nombre: 'Sin kit' },
            ]
          : [{ id: 'n1', codigoRecinto: '2001', nombre: 'Escuelita', cdaDestinoId: 'r1' }],
      ),
    );
    prisma.parejaCda.findMany.mockResolvedValue([
      {
        kitId: 'k1',
        fecha: T('2026-11-01T00:00:00Z'),
        operador: { apellidosNombres: 'PEREZ ANA', telefono: '0991111111' },
        asistente: { apellidosNombres: 'RUIZ JUAN', telefono: '0992222222' },
      },
      // Una pareja más vieja del mismo kit: no se usa.
      { kitId: 'k1', fecha: T('2026-10-28T00:00:00Z'), operador: { apellidosNombres: 'VIEJA', telefono: null }, asistente: null },
    ]);
    prisma.eventoTracking.findMany.mockImplementation(({ where }: { where: { tipo: unknown } }) =>
      Promise.resolve(
        where.tipo === 'LLEGADA_NO_CDA'
          ? [{ recintoId: 'n1', ocurridoEn: T('2026-11-29T15:00:00Z'), desdeOffline: false }]
          : [
              { operadorId: 'u1', tipo: 'SALIDA_DPI', ocurridoEn: T('2026-11-29T13:12:00Z'), desdeOffline: true },
              // Repetir la marca no cambia la hora.
              { operadorId: 'u1', tipo: 'SALIDA_DPI', ocurridoEn: T('2026-11-29T13:40:00Z'), desdeOffline: false },
            ],
      ),
    );
    prisma.recepcionDpiKit.findMany.mockResolvedValue([]);
    distributivo.asignaciones.mockResolvedValue([
      { codigoRecinto: '971', localidad: '', parroquia: '', numeroTecnico: 1, tecnico: 'Jairo' },
      { codigoRecinto: '1487', localidad: '', parroquia: '', numeroTecnico: 2, tecnico: 'Carlos' },
    ]);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.TELEGRAM_CHAT_ID_JORNADA = CHAT;
    datosBase();
    const moduleRef = await Test.createTestingModule({
      providers: [
        JornadaService,
        { provide: PrismaService, useValue: prisma },
        { provide: DistributivoTecnicosClient, useValue: distributivo },
        { provide: TelegramNotifier, useValue: telegram },
      ],
    }).compile();
    service = moduleRef.get(JornadaService);
  });

  afterEach(() => {
    delete process.env.TELEGRAM_CHAT_ID_JORNADA;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_CHAT_IDS_CONSULTA;
  });

  it('si la Jornada apunta al grupo de enlaces o a uno de consulta, queda apagada (lleva teléfonos)', () => {
    process.env.TELEGRAM_CHAT_ID = CHAT;
    expect(esChatJornada(CHAT)).toBe(false);
    process.env.TELEGRAM_CHAT_ID = '-100200';
    process.env.TELEGRAM_CHAT_IDS_CONSULTA = '-1001, -100777';
    expect(esChatJornada(CHAT)).toBe(false);
    process.env.TELEGRAM_CHAT_IDS_CONSULTA = '-1001';
    expect(esChatJornada(CHAT)).toBe(true);
  });

  it('el día de jornada empieza a las 04:00 de Ecuador', () => {
    // 01:30 del 30-nov en Ecuador: sigue siendo la jornada del 29.
    expect(diaDeJornada(T('2026-11-30T06:30:00Z'))).toEqual({ fecha: '2026-11-29', desde: T('2026-11-29T09:00:00Z') });
    // 04:30 del 30-nov en Ecuador: ya es el 30.
    expect(diaDeJornada(T('2026-11-30T09:30:00Z'))).toEqual({ fecha: '2026-11-30', desde: T('2026-11-30T09:00:00Z') });
  });

  it('solo el chat de TELEGRAM_CHAT_ID_JORNADA es el grupo Jornada; sin la variable está apagado', () => {
    expect(esChatJornada(CHAT)).toBe(true);
    expect(esChatJornada(-100777)).toBe(true);
    expect(esChatJornada('-100200')).toBe(false);
    expect(esChatJornada(undefined)).toBe(false);
    delete process.env.TELEGRAM_CHAT_ID_JORNADA;
    expect(esChatJornada(CHAT)).toBe(false);
  });

  describe('cargar', () => {
    it('arma una fila por kit con la pareja más reciente, el técnico y el primer registro de cada momento', async () => {
      const j = (await service.cargar())!;
      expect(j.evento).toBe('Elecciones 2027');
      expect(j.unidades).toEqual([
        {
          codigoRecinto: '971',
          nombreRecinto: 'UE Chaltura',
          tecnico: { numero: 1, nombre: 'Jairo' },
          personas: [
            { nombre: 'PEREZ ANA', telefono: '0991111111', rol: 'Op.' },
            { nombre: 'RUIZ JUAN', telefono: '0992222222', rol: 'Asis.' },
          ],
          registros: { SALIDA_DPI: { en: T('2026-11-29T13:12:00Z'), sinSenal: true } },
          kitRecibido: null,
        },
        {
          codigoRecinto: '1487',
          nombreRecinto: 'UE Apuela',
          tecnico: { numero: 2, nombre: 'Carlos' },
          // Sin pareja: quien tiene el kit en la app.
          personas: [{ nombre: 'Mora Luis', telefono: null, rol: 'Op.' }],
          registros: {},
          kitRecibido: null,
        },
      ]);
      expect(j.sinKit).toEqual([{ codigoRecinto: '1500', nombreRecinto: 'Sin kit', tecnico: { numero: null, nombre: '' } }]);
      expect(j.noCdas).toEqual([
        {
          codigoRecinto: '2001',
          nombreRecinto: 'Escuelita',
          codigoCda: '971',
          tecnico: { numero: 1, nombre: 'Jairo' },
          personas: j.unidades[0].personas,
          visita: { en: T('2026-11-29T15:00:00Z'), sinSenal: false },
        },
      ]);
      expect(j.sinDistributivo).toBe(false);
    });

    it('excluye los kits de prueba y los que no tienen operador o recinto, en orden fijo', async () => {
      await service.cargar();
      expect(prisma.kitElectoral.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventoId: 'ev1', esPrueba: false, operadorId: { not: null }, recintoId: { not: null } },
          orderBy: [{ recinto: { codigoRecinto: 'asc' } }, { id: 'asc' }],
        }),
      );
    });

    it('solo cuenta los registros del día de jornada (las pruebas de otros días no marcan a nadie)', async () => {
      await service.cargar(T('2026-11-29T15:00:00Z').getTime());
      const desde = T('2026-11-29T09:00:00Z');
      const filtros = prisma.eventoTracking.findMany.mock.calls.map(([q]) => q.where.ocurridoEn);
      expect(filtros).toEqual([{ gte: desde }, { gte: desde }]);
      expect(prisma.recepcionDpiKit.findMany.mock.calls[0][0].where.confirmadoEn).toEqual({ gte: desde });
    });

    it('usa la pareja de hoy o la anterior más reciente, no la de una prueba futura', async () => {
      prisma.parejaCda.findMany.mockResolvedValue([
        { kitId: 'k1', fecha: T('2026-12-05T00:00:00Z'), operador: { apellidosNombres: 'FUTURA', telefono: null }, asistente: null },
        { kitId: 'k1', fecha: T('2026-11-29T00:00:00Z'), operador: { apellidosNombres: 'DE HOY', telefono: null }, asistente: null },
        { kitId: 'k1', fecha: T('2026-10-28T00:00:00Z'), operador: { apellidosNombres: 'VIEJA', telefono: null }, asistente: null },
        // Solo parejas futuras: la más próxima.
        { kitId: 'k2', fecha: T('2026-12-20T00:00:00Z'), operador: { apellidosNombres: 'LEJANA', telefono: null }, asistente: null },
        { kitId: 'k2', fecha: T('2026-12-05T00:00:00Z'), operador: { apellidosNombres: 'PROXIMA', telefono: null }, asistente: null },
      ]);
      const j = (await service.cargar(T('2026-11-29T15:00:00Z').getTime()))!;
      expect(j.unidades.map((u) => u.personas[0].nombre)).toEqual(['DE HOY', 'PROXIMA']);
    });

    it('con dos kits, el operador entregó solo cuando se recibieron los dos', async () => {
      const [k1] = await prisma.kitElectoral.findMany();
      prisma.kitElectoral.findMany.mockResolvedValue([k1, { ...k1, id: 'k9' }]);
      prisma.recepcionDpiKit.findMany.mockResolvedValue([{ kitId: 'k1', confirmadoEn: T('2026-11-29T23:00:00Z') }]);
      expect((await service.cargar())!.unidades[0].kitRecibido).toBeNull();
    });

    it('reutiliza la carga unos segundos y vuelve a consultar después', async () => {
      const t0 = T('2026-11-29T15:00:00Z').getTime();
      await service.cargar(t0);
      await service.cargar(t0 + 3_000);
      expect(prisma.eventoElectoral.findFirst).toHaveBeenCalledTimes(1);
      await service.cargar(t0 + 6_000);
      expect(prisma.eventoElectoral.findFirst).toHaveBeenCalledTimes(2);
    });

    it('si la carga falla no se guarda: el siguiente toque vuelve a consultar', async () => {
      const t0 = T('2026-11-29T15:00:00Z').getTime();
      prisma.eventoElectoral.findFirst.mockRejectedValueOnce(new Error('base caída'));
      await expect(service.cargar(t0)).rejects.toThrow('base caída');
      await service.cargar(t0 + 1_000);
      expect(prisma.eventoElectoral.findFirst).toHaveBeenCalledTimes(2);
    });

    it('sin evento activo devuelve null', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValue(null);
      expect(await service.cargar()).toBeNull();
    });

    it('si el distributivo falla, sigue sin técnicos y lo marca', async () => {
      distributivo.asignaciones.mockRejectedValue(new DistributivoNoConfigurado());
      const j = (await service.cargar())!;
      expect(j.sinDistributivo).toBe(true);
      expect(j.unidades.every((u) => u.tecnico.numero === null)).toBe(true);
    });

    it('la primera recepción del kit en el DPEI cuenta como kit recibido', async () => {
      prisma.recepcionDpiKit.findMany.mockResolvedValue([
        { kitId: 'k2', confirmadoEn: T('2026-11-29T23:30:00Z') },
        { kitId: 'k2', confirmadoEn: T('2026-11-29T23:10:00Z') },
      ]);
      const j = (await service.cargar())!;
      expect(j.unidades[1].kitRecibido).toEqual(T('2026-11-29T23:10:00Z'));
    });

    it('dos kits del mismo operador son una sola fila', async () => {
      const [k1] = await prisma.kitElectoral.findMany();
      prisma.kitElectoral.findMany.mockResolvedValue([k1, { ...k1, id: 'k9' }]);
      const j = (await service.cargar())!;
      expect(j.unidades).toHaveLength(1);
    });
  });

  describe('mensajes del grupo', () => {
    it('un botón fijo manda el resumen con los botones de técnicos, en el grupo Jornada', async () => {
      expect(await service.atenderMensaje(CHAT, BOTONES_JORNADA.SALIDA_DPI)).toBe(true);
      expect(telegram.responderEn).toHaveBeenCalledWith(CHAT, expect.any(Function));
      const [texto, , botones] = telegram.enviarHtml.mock.calls[0];
      expect(texto).toContain('<b>1 de 2</b> · faltan 1');
      expect(JSON.stringify(botones)).toContain('jor:sd:1:0');
    });

    it.each(['/jornada', '/jornada@CNE_Enlaces_bot', '/start', '/menu@CNE_Enlaces_bot'])('"%s" manda el teclado de la Jornada', async (texto) => {
      expect(await service.atenderMensaje(CHAT, texto)).toBe(true);
      const [, , teclado] = telegram.enviarHtml.mock.calls[0];
      expect(JSON.stringify(teclado)).toContain(BOTONES_JORNADA.KIT);
    });

    it('otro texto, u otro chat, no es de la Jornada', async () => {
      expect(await service.atenderMensaje(CHAT, 'hola')).toBe(false);
      expect(await service.atenderMensaje('-100200', BOTONES_JORNADA.SALIDA_DPI)).toBe(false);
      expect(telegram.enviarHtml).not.toHaveBeenCalled();
    });

    it('sin evento activo lo dice', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValue(null);
      await service.atenderMensaje(CHAT, BOTONES_JORNADA.LLEGADA_DPI);
      expect(telegram.enviarHtml).toHaveBeenCalledWith('No hay un evento electoral activo.', expect.any(String), expect.anything());
    });

    it('si la base falla avisa en el grupo en vez de callar', async () => {
      prisma.kitElectoral.findMany.mockRejectedValue(new Error('base caída'));
      await service.atenderMensaje(CHAT, BOTONES_JORNADA.LLEGADA_DPI);
      expect(telegram.enviarHtml).toHaveBeenCalledWith(
        expect.stringContaining('No se pudo consultar la jornada'),
        expect.any(String),
        expect.anything(),
      );
    });
  });

  describe('botones bajo los mensajes', () => {
    it('un técnico edita el mismo mensaje con su detalle', async () => {
      expect(await service.atenderBoton(CHAT, 'cb', 'jor:sd:1:0', 55)).toBe(true);
      expect(telegram.responderBoton).toHaveBeenCalledWith('cb');
      const [messageId, texto] = telegram.editarHtml.mock.calls[0];
      expect(messageId).toBe(55);
      expect(texto).toContain('Salida del DPEI · Jairo');
      expect(texto).toContain('<b>971 · UE Chaltura</b> · 08:12 📴');
      expect(texto).toContain('+593991111111');
    });

    it('"res" vuelve al resumen en el mismo mensaje', async () => {
      await service.atenderBoton(CHAT, 'cb', 'jor:lr:res:0', 55);
      expect(telegram.editarHtml.mock.calls[0][1]).toContain('Llegada al recinto');
    });

    it('un técnico que ya no está en el distributivo vuelve al resumen', async () => {
      await service.atenderBoton(CHAT, 'cb', 'jor:sd:9:0', 55);
      expect(telegram.editarHtml.mock.calls[0][1]).toContain('<b>1 de 2</b>');
    });

    it('sin evento activo edita el mismo mensaje en vez de mandar otro', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValue(null);
      await service.atenderBoton(CHAT, 'cb', 'jor:sd:1:0', 55);
      expect(telegram.editarHtml).toHaveBeenCalledWith(55, 'No hay un evento electoral activo.', expect.any(String), { inline_keyboard: [] });
      expect(telegram.enviarHtml).not.toHaveBeenCalled();
    });

    it('una página que ya no existe muestra la última', async () => {
      await service.atenderBoton(CHAT, 'cb', 'jor:sd:1:9', 55);
      expect(telegram.editarHtml.mock.calls[0][1]).not.toContain('pág.');
    });

    it('dos toques seguidos del mismo botón consultan una sola vez', async () => {
      await service.atenderBoton(CHAT, 'cb1', 'jor:sd:1:0', 55);
      await service.atenderBoton(CHAT, 'cb2', 'jor:sd:1:0', 55);
      expect(telegram.responderBoton).toHaveBeenCalledTimes(2);
      expect(telegram.editarHtml).toHaveBeenCalledTimes(1);
    });

    it('un botón de otro chat o con otro formato no es de la Jornada', async () => {
      expect(await service.atenderBoton('-100200', 'cb', 'jor:sd:1:0', 55)).toBe(false);
      expect(await service.atenderBoton(CHAT, 'cb', 'asig:1', 55)).toBe(false);
      expect(telegram.responderBoton).not.toHaveBeenCalled();
    });
  });
});
