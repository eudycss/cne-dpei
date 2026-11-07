import { Test } from '@nestjs/testing';
import { PrismaService } from '../../db/prisma.service';
import { DistributivoNoConfigurado, DistributivoTecnicosClient } from '../distributivo-tecnicos.client';
import { TelegramNotifier } from '../telegram-notifier';
import { BOTONES_JORNADA, BOTON_CONSULTAR_CDA } from './jornada';
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
    recepcionKit: { findMany: jest.fn() },
    posicionGps: { groupBy: jest.fn() },
    configEnlaces: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const distributivo = { asignaciones: jest.fn() };
  const telegram = {
    enviarHtml: jest.fn().mockResolvedValue(undefined),
    editarHtml: jest.fn().mockResolvedValue(undefined),
    responderBoton: jest.fn().mockResolvedValue(undefined),
    esAdministrador: jest.fn().mockResolvedValue(false),
    responderEn: jest.fn((_chat: string, fn: () => Promise<unknown>) => fn()),
  };

  /** Dos kits: 971 (Jairo, con pareja, salió del DPEI) y 1487 (Carlos, sin pareja). Un CDA sin kit. */
  function datosBase() {
    prisma.eventoElectoral.findFirst.mockResolvedValue({ id: 'ev1', nombre: 'Elecciones 2027' });
    prisma.kitElectoral.findMany.mockResolvedValue([
      {
        id: 'k1',
        operadorId: 'u1',
        recinto: { id: 'r1', codigoRecinto: '971', nombre: 'UE Chaltura', tiempoDpiMin: 45, canton: { codigo: '45', nombre: 'ANTONIO ANTE' } },
        operador: { nombres: 'Ana', apellidos: 'Pérez', telefono: '0990000001' },
      },
      {
        id: 'k2',
        operadorId: 'u2',
        recinto: { id: 'r2', codigoRecinto: '1487', nombre: 'UE Apuela', canton: { codigo: '30', nombre: 'IBARRA' } },
        operador: { nombres: 'Luis', apellidos: 'Mora', telefono: null },
      },
    ]);
    prisma.recinto.findMany.mockImplementation(({ where }: { where: { tipo: string } }) =>
      Promise.resolve(
        where.tipo === 'CDA'
          ? [
              { id: 'r1', codigoRecinto: '971', nombre: 'UE Chaltura', canton: { codigo: '45', nombre: 'ANTONIO ANTE' } },
              { id: 'r2', codigoRecinto: '1487', nombre: 'UE Apuela', canton: { codigo: '30', nombre: 'IBARRA' } },
              { id: 'r3', codigoRecinto: '1500', nombre: 'Sin kit', canton: null },
            ]
          : [
              { id: 'n1', codigoRecinto: '2001', nombre: 'Escuelita', cdaDestinoId: 'r1', canton: { codigo: '45', nombre: 'ANTONIO ANTE' } },
              // Su CDA (1500) no tiene kit: no cuenta.
              { id: 'n2', codigoRecinto: '2002', nombre: 'Lejana', cdaDestinoId: 'r3', canton: null },
            ],
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
    prisma.recepcionKit.findMany.mockResolvedValue([]);
    prisma.posicionGps.groupBy.mockResolvedValue([{ operadorId: 'u1', _max: { capturadoEn: T('2026-11-29T13:30:00Z') } }]);
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
      // El GPS se consulta solo de quien va en camino (u1 salió y no llegó; u2 no salió).
      expect(prisma.posicionGps.groupBy.mock.calls[0][0].where.operadorId).toEqual({ in: ['u1'] });
      expect(j.unidades).toEqual([
        {
          operadorId: 'u1',
          codigoRecinto: '971',
          nombreRecinto: 'UE Chaltura',
          tecnico: { numero: 1, nombre: 'Jairo' },
          canton: { codigo: 45, nombre: 'ANTONIO ANTE' },
          personas: [
            { nombre: 'PEREZ ANA', telefono: '0991111111', rol: 'Op.' },
            { nombre: 'RUIZ JUAN', telefono: '0992222222', rol: 'Asis.' },
          ],
          registros: { SALIDA_DPI: { en: T('2026-11-29T13:12:00Z'), sinSenal: true } },
          kitRecibido: null,
          kitEscaneado: null,
          actas: null,
          // Tiempo de viaje del recinto y último GPS del día (para los avisos).
          tiempoViajeMin: 45,
          ultimoGps: T('2026-11-29T13:30:00Z'),
        },
        {
          operadorId: 'u2',
          codigoRecinto: '1487',
          nombreRecinto: 'UE Apuela',
          tecnico: { numero: 2, nombre: 'Carlos' },
          canton: { codigo: 30, nombre: 'IBARRA' },
          // Sin pareja: quien tiene el kit en la app.
          personas: [{ nombre: 'Mora Luis', telefono: null, rol: 'Op.' }],
          registros: {},
          kitRecibido: null,
          kitEscaneado: null,
          actas: null,
          tiempoViajeMin: null,
          ultimoGps: null,
        },
      ]);
      expect(j.sinKit).toEqual([
        {
          codigoRecinto: '1500',
          nombreRecinto: 'Sin kit',
          tecnico: { numero: null, nombre: '' },
          canton: { codigo: null, nombre: 'Sin cantón' },
        },
      ]);
      expect(j.noCdas).toEqual([
        {
          codigoRecinto: '2001',
          nombreRecinto: 'Escuelita',
          codigoCda: '971',
          nombreCda: 'UE Chaltura',
          canton: { codigo: 45, nombre: 'ANTONIO ANTE' },
          tecnico: { numero: 1, nombre: 'Jairo' },
          personas: j.unidades[0].personas,
          visita: { en: T('2026-11-29T15:00:00Z'), sinSenal: false },
          cdaConKit: true,
        },
        {
          codigoRecinto: '2002',
          nombreRecinto: 'Lejana',
          codigoCda: '1500',
          nombreCda: 'Sin kit',
          canton: { codigo: null, nombre: 'Sin cantón' },
          tecnico: { numero: null, nombre: '' },
          personas: [],
          visita: null,
          cdaConKit: false,
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
      expect(prisma.recepcionKit.findMany.mock.calls[0][0].where).toEqual({
        kitId: { in: ['k1', 'k2'] },
        operadorId: { in: ['u1', 'u2'] },
        confirmadoEn: { gte: desde },
      });
    });

    it('cumplimiento: el escaneo del kit con la foto del militar y los reportes de la salida del recinto', async () => {
      prisma.recepcionKit.findMany.mockResolvedValue([
        { kitId: 'k1', operadorId: 'u1', confirmadoEn: T('2026-11-29T14:10:00Z'), desdeOffline: true, fotoMilitarUrl: 'militares/a.bin' },
        // APK vieja: escaneó sin foto.
        { kitId: 'k2', operadorId: 'u2', confirmadoEn: T('2026-11-29T14:20:00Z'), desdeOffline: false, fotoMilitarUrl: null },
      ]);
      prisma.eventoTracking.findMany.mockImplementation(({ where }: { where: { tipo: unknown } }) =>
        Promise.resolve(
          where.tipo === 'LLEGADA_NO_CDA'
            ? []
            : [
                {
                  operadorId: 'u1',
                  tipo: 'SALIDA_RECINTO',
                  ocurridoEn: T('2026-11-29T22:00:00Z'),
                  desdeOffline: false,
                  actaInstalacionUrl: 'actas/i.bin',
                  actaEscrutinioUrl: 'actas/e.bin',
                },
                // Una salida repetida no cambia los reportes de la primera.
                { operadorId: 'u1', tipo: 'SALIDA_RECINTO', ocurridoEn: T('2026-11-29T22:30:00Z'), desdeOffline: false, actaInstalacionUrl: null, actaEscrutinioUrl: null },
              ],
        ),
      );
      const [u1, u2] = (await service.cargar())!.unidades;
      expect(u1.kitEscaneado).toEqual({ en: T('2026-11-29T14:10:00Z'), sinSenal: true, conFoto: true });
      expect(u1.actas).toEqual({ instalacion: true, escrutinio: true });
      expect(u2.kitEscaneado).toEqual({ en: T('2026-11-29T14:20:00Z'), sinSenal: false, conFoto: false });
      // No marcó la salida del recinto: los reportes aún no se saben.
      expect(u2.actas).toBeNull();
    });

    it('un kit reasignado: cuenta el escaneo de su operador actual, no el de uno anterior', async () => {
      prisma.recepcionKit.findMany.mockResolvedValue([
        { kitId: 'k1', operadorId: 'u-anterior', confirmadoEn: T('2026-11-29T13:00:00Z'), desdeOffline: false, fotoMilitarUrl: 'militares/x.bin' },
        { kitId: 'k1', operadorId: 'u1', confirmadoEn: T('2026-11-29T14:00:00Z'), desdeOffline: false, fotoMilitarUrl: 'militares/a.bin' },
      ]);
      expect((await service.cargar())!.unidades[0].kitEscaneado?.en).toEqual(T('2026-11-29T14:00:00Z'));
    });

    it('los reportes valen si vienen en cualquiera de sus salidas del recinto del día', async () => {
      prisma.eventoTracking.findMany.mockImplementation(({ where }: { where: { tipo: unknown } }) =>
        Promise.resolve(
          where.tipo === 'LLEGADA_NO_CDA'
            ? []
            : [
                { operadorId: 'u1', tipo: 'SALIDA_RECINTO', ocurridoEn: T('2026-11-29T22:00:00Z'), desdeOffline: false, actaInstalacionUrl: 'actas/i.bin', actaEscrutinioUrl: null },
                { operadorId: 'u1', tipo: 'SALIDA_RECINTO', ocurridoEn: T('2026-11-29T22:30:00Z'), desdeOffline: false, actaInstalacionUrl: null, actaEscrutinioUrl: 'actas/e.bin' },
              ],
        ),
      );
      expect((await service.cargar())!.unidades[0].actas).toEqual({ instalacion: true, escrutinio: true });
    });

    it('con dos kits, escaneó solo cuando escaneó los dos (hora del último)', async () => {
      const [k1] = await prisma.kitElectoral.findMany();
      prisma.kitElectoral.findMany.mockResolvedValue([k1, { ...k1, id: 'k9' }]);
      const escaneo = (kitId: string, hhmm: string) => ({
        kitId,
        operadorId: 'u1',
        confirmadoEn: T(`2026-11-29T${hhmm}:00Z`),
        desdeOffline: false,
        fotoMilitarUrl: 'militares/a.bin',
      });
      prisma.recepcionKit.findMany.mockResolvedValue([escaneo('k1', '14:00')]);
      expect((await service.cargar(1))!.unidades[0].kitEscaneado).toBeNull();
      prisma.recepcionKit.findMany.mockResolvedValue([escaneo('k1', '14:00'), escaneo('k9', '14:05')]);
      expect((await service.cargar(10_000_000))!.unidades[0].kitEscaneado?.en).toEqual(T('2026-11-29T14:05:00Z'));
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
      expect(JSON.stringify(botones)).toContain('jor:sd:t:1:0');
    });

    it('"Llegada NO CDA" abre por CDA, sin contar los NO CDA de un CDA sin kit, y cada CDA abre su ficha', async () => {
      await service.atenderMensaje(CHAT, BOTONES_JORNADA.NO_CDA);
      const [texto, , botones] = telegram.enviarHtml.mock.calls[0];
      expect(texto).toContain('· por CDA');
      expect(texto).toContain('<b>1 de 1</b> ✅');
      expect(texto).toContain('✅ <b>971</b> · UE Chaltura — 1/1');
      expect(texto).toContain('⚪ 1 NO CDA de CDA sin kit (no cuentan)');
      expect(JSON.stringify(botones)).toContain('jor:cda:971');
      expect(JSON.stringify(botones)).toContain('• 🏫 Por CDA •');
    });

    it('el botón "por CDA" edita el mismo mensaje; desde la ficha se vuelve con "NO CDA por CDA"', async () => {
      expect(await service.atenderBoton(CHAT, 'cb', 'jor:nc:d:res:0', 70)).toBe(true);
      const [id, texto, , teclado] = telegram.editarHtml.mock.calls[0];
      expect(id).toBe(70);
      expect(texto).toContain('✅ <b>971</b> · UE Chaltura — 1/1');
      expect(JSON.stringify(teclado)).toContain('jor:cda:971');

      await service.atenderBoton(CHAT, 'cb2', 'jor:cda:971', 70);
      const [, ficha, , tecladoFicha] = telegram.editarHtml.mock.calls[1];
      expect(ficha).toContain('NO CDA: 1 de 1 llegó');
      expect(JSON.stringify(tecladoFicha)).toContain('jor:nc:d:res:0');
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

  describe('frecuencia del resumen automático', () => {
    beforeEach(() => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ minutosResumenJornada: 15 });
      telegram.esAdministrador.mockResolvedValue(false);
    });

    it('"/frecuencia" muestra la actual marcada y las opciones', async () => {
      expect(await service.atenderMensaje(CHAT, '/frecuencia')).toBe(true);
      const [texto, , botones] = telegram.enviarHtml.mock.calls[0];
      expect(texto).toContain('cada <b>15 min</b>');
      expect(JSON.stringify(botones)).toContain('✅ 15 min');
      expect(JSON.stringify(botones)).toContain('jor:frec:30');
    });

    it('sin fila de configuración usa 15 min', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue(null);
      expect(await service.minutosResumen()).toBe(15);
    });

    it('el botón "⏱ Frecuencia" del resumen manda las opciones', async () => {
      expect(await service.atenderBoton(CHAT, 'cb', 'jor:frec', 55, 111)).toBe(true);
      expect(telegram.responderBoton).toHaveBeenCalledWith('cb');
      expect(telegram.enviarHtml.mock.calls[0][0]).toContain('Resumen automático');
    });

    it('quien no es administrador del grupo no la cambia y recibe el aviso', async () => {
      await service.atenderBoton(CHAT, 'cb', 'jor:frec:30', 55, 111);
      expect(telegram.esAdministrador).toHaveBeenCalledWith(111);
      expect(telegram.responderBoton).toHaveBeenCalledWith('cb', expect.stringContaining('Solo los administradores'));
      expect(prisma.configEnlaces.upsert).not.toHaveBeenCalled();
      expect(telegram.editarHtml).not.toHaveBeenCalled();
    });

    it('sin remitente identificable (administrador anónimo) tampoco la cambia', async () => {
      await service.atenderBoton(CHAT, 'cb', 'jor:frec:30', 55, undefined);
      expect(telegram.esAdministrador).not.toHaveBeenCalled();
      expect(prisma.configEnlaces.upsert).not.toHaveBeenCalled();
    });

    it('un administrador la cambia y el mensaje muestra la nueva marcada', async () => {
      telegram.esAdministrador.mockResolvedValue(true);
      await service.atenderBoton(CHAT, 'cb', 'jor:frec:30', 55, 111);
      expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith({
        where: { id: 1 },
        create: { id: 1, minutosResumenJornada: 30 },
        update: { minutosResumenJornada: 30 },
      });
      const [messageId, texto, , botones] = telegram.editarHtml.mock.calls[0];
      expect(messageId).toBe(55);
      expect(texto).toContain('ahora llega cada <b>30 min</b>');
      expect(JSON.stringify(botones)).toContain('✅ 30 min');
    });

    it('ofrece 4 h, 8 h y Detener; "Detener" guarda 0 y lo dice', async () => {
      telegram.esAdministrador.mockResolvedValue(true);
      await service.atenderMensaje(CHAT, '/frecuencia');
      const botones = JSON.stringify(telegram.enviarHtml.mock.calls[0][2]);
      expect(botones).toContain('"4 h"');
      expect(botones).toContain('jor:frec:480');
      expect(botones).toContain('⏸ Detener');

      await service.atenderBoton(CHAT, 'cb', 'jor:frec:0', 55, 111);
      expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { minutosResumenJornada: 0 } }));
      const [, texto, , teclado] = telegram.editarHtml.mock.calls[0];
      expect(texto).toContain('Resumen automático detenido ahora');
      expect(JSON.stringify(teclado)).toContain('✅ ⏸ Detener');
    });

    it('un valor que no está entre las opciones solo muestra las opciones (no guarda)', async () => {
      telegram.esAdministrador.mockResolvedValue(true);
      await service.atenderBoton(CHAT, 'cb', 'jor:frec:7', 55, 111);
      expect(prisma.configEnlaces.upsert).not.toHaveBeenCalled();
      expect(telegram.enviarHtml.mock.calls[0][0]).toContain('Resumen automático');
    });

    it('un botón de frecuencia de otro chat no es de la Jornada', async () => {
      expect(await service.atenderBoton('-100200', 'cb', 'jor:frec:30', 55, 111)).toBe(false);
      expect(prisma.configEnlaces.upsert).not.toHaveBeenCalled();
    });
  });

  describe('botones bajo los mensajes', () => {
    it('un técnico edita el mismo mensaje con su detalle (también con un botón de antes, sin agrupación)', async () => {
      expect(await service.atenderBoton(CHAT, 'cb', 'jor:sd:1:0', 55)).toBe(true);
      expect(telegram.responderBoton).toHaveBeenCalledWith('cb');
      const [messageId, texto] = telegram.editarHtml.mock.calls[0];
      expect(messageId).toBe(55);
      expect(texto).toContain('Salida del DPEI · Jairo');
      expect(texto).toContain('<b>971 · UE Chaltura</b> · 08:12 📴');
      expect(texto).toContain('+593991111111');
    });

    it('por cantón: un cantón muestra solo sus recintos y el resumen se arma por cantón', async () => {
      await service.atenderBoton(CHAT, 'cb', 'jor:sd:c:30:0', 55);
      const detalle = telegram.editarHtml.mock.calls[0][1];
      expect(detalle).toContain('Salida del DPEI · IBARRA');
      expect(detalle).toContain('1487');
      expect(detalle).not.toContain('971 ·');

      await service.atenderBoton(CHAT, 'cb2', 'jor:sd:c:res:0', 56);
      expect(telegram.editarHtml.mock.calls[1][1]).toContain('por cantón');
      expect(JSON.stringify(telegram.editarHtml.mock.calls[1][3])).toContain('jor:sd:c:45:0');
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

  describe('Consultar CDA', () => {
    it('el botón pide el código y el siguiente mensaje de esa persona se busca', async () => {
      expect(await service.atenderMensaje(CHAT, BOTON_CONSULTAR_CDA, 9)).toBe(true);
      expect(telegram.enviarHtml.mock.calls[0][0]).toContain('Escriba el código o el nombre del CDA');

      expect(await service.atenderMensaje(CHAT, '971', 9)).toBe(true);
      const [ficha, , botones] = telegram.enviarHtml.mock.calls[1];
      expect(ficha).toContain('<b>🔎 971 · UE Chaltura</b>');
      expect(ficha).toContain('ANTONIO ANTE · Técnico: Jairo');
      expect(ficha).toContain('🚐 Salió del DPEI 08:12 📴');
      expect(ficha).toContain('🏫 <b>NO CDA: 1 de 1 llegó</b>');
      expect(JSON.stringify(botones)).toContain('jor:cda:971');

      // La espera se consumió: otro texto ya no es de la Jornada.
      expect(await service.atenderMensaje(CHAT, 'hola', 9)).toBe(false);
    });

    it('el pedido usa "responder" (funciona con la privacidad de grupos del bot) y /cda solo hace lo mismo', async () => {
      await service.atenderMensaje(CHAT, '/cda', 9);
      const [texto, , markup] = telegram.enviarHtml.mock.calls[0];
      expect(texto).toContain('Escriba el código o el nombre del CDA');
      expect(markup).toEqual(expect.objectContaining({ force_reply: true }));
      expect(await service.atenderMensaje(CHAT, '1487', 9)).toBe(true);
      expect(telegram.enviarHtml.mock.calls[1][0]).toContain('🔎 1487 · UE Apuela');
    });

    it('mientras espera, otro comando no se toma como el código', async () => {
      await service.atenderMensaje(CHAT, BOTON_CONSULTAR_CDA, 9);
      expect(await service.atenderMensaje(CHAT, '/preguntar algo', 9)).toBe(false);
      // La espera sigue: el código llega después.
      expect(await service.atenderMensaje(CHAT, '971', 9)).toBe(true);
    });

    it('la espera vence a los 5 minutos', async () => {
      const ahora = jest.spyOn(Date, 'now').mockReturnValue(T('2026-11-29T15:00:00Z').getTime());
      try {
        await service.atenderMensaje(CHAT, BOTON_CONSULTAR_CDA, 9);
        ahora.mockReturnValue(T('2026-11-29T15:05:01Z').getTime());
        expect(await service.atenderMensaje(CHAT, '971', 9)).toBe(false);
      } finally {
        ahora.mockRestore();
      }
    });

    it('la espera es de cada persona: otra persona escribiendo no la usa', async () => {
      await service.atenderMensaje(CHAT, BOTON_CONSULTAR_CDA, 9);
      expect(await service.atenderMensaje(CHAT, '971', 10)).toBe(false);
    });

    it('un NO CDA lleva a la ficha de su CDA y lo dice', async () => {
      await service.atenderMensaje(CHAT, '/cda 2001');
      const [texto] = telegram.enviarHtml.mock.calls[0];
      expect(texto).toContain('🏫 2001 · Escuelita es un NO CDA de este CDA');
      expect(texto).toContain('🔎 971 · UE Chaltura');
    });

    it('/cda con un nombre que coincide con varios da botones para elegir', async () => {
      const kits = await prisma.kitElectoral.findMany();
      prisma.kitElectoral.findMany.mockResolvedValue([kits[0], { ...kits[1], recinto: { ...kits[1].recinto, nombre: 'UE Chaltura Bajo' } }]);
      await service.atenderMensaje(CHAT, '/cda@CNE_Enlaces_bot chaltura');
      const [texto, , botones] = telegram.enviarHtml.mock.calls[0];
      expect(texto).toContain('Encontré');
      const datos = (botones as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard.flat().map((b) => b.callback_data);
      expect(datos).toEqual(expect.arrayContaining(['jor:cda:971', 'jor:cda:1487']));
    });

    it('si no encuentra nada lo dice (escapando lo escrito)', async () => {
      await service.atenderMensaje(CHAT, '/cda <zzz>');
      expect(telegram.enviarHtml.mock.calls[0][0]).toContain('No encontré un CDA o NO CDA con "&lt;zzz&gt;"');
    });

    it('sin remitente (administrador anónimo) explica cómo usar /cda', async () => {
      await service.atenderMensaje(CHAT, BOTON_CONSULTAR_CDA);
      expect(telegram.enviarHtml.mock.calls[0][0]).toContain('/cda');
    });

    it('el botón de una ficha edita el mismo mensaje con la ficha al día', async () => {
      expect(await service.atenderBoton(CHAT, 'cb', 'jor:cda:1487', 77)).toBe(true);
      const [messageId, texto, , botones] = telegram.editarHtml.mock.calls[0];
      expect(messageId).toBe(77);
      expect(texto).toContain('🔎 1487 · UE Apuela');
      expect(JSON.stringify(botones)).toContain('jor:cda:1487');

      await service.atenderBoton(CHAT, 'cb2', 'jor:cda:9999', 78);
      expect(telegram.editarHtml.mock.calls[1][1]).toBe('El CDA 9999 no está en este evento.');
    });
  });
});
