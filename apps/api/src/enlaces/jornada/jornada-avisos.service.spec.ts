import type { Jornada, UnidadJornada } from './jornada';
import { FALLOS_PARA_DESCARTAR, JornadaAvisosService, MAX_AVISOS_POR_VUELTA } from './jornada-avisos.service';
import type { JornadaService } from './jornada.service';
import type { TelegramNotifier } from '../telegram-notifier';
import type { PrismaService } from '../../db/prisma.service';

const CHAT = '-100777';
// 15:00 UTC = 10:00 en Ecuador; día de jornada 2026-11-29.
const AHORA = new Date('2026-11-29T15:00:00Z');
const min = (n: number) => new Date(AHORA.getTime() + n * 60_000);

const unidad = (operadorId: string, extra: Partial<UnidadJornada> = {}): UnidadJornada => ({
  operadorId,
  codigoRecinto: operadorId,
  nombreRecinto: `Recinto ${operadorId}`,
  tecnico: { numero: 1, nombre: 'Jairo' },
  canton: { codigo: 30, nombre: 'IBARRA' },
  personas: [],
  // Salió hace 75 min con 60 de viaje: retraso.
  registros: { SALIDA_DPI: { en: min(-75), sinSenal: false } },
  kitRecibido: null,
  kitEscaneado: null,
  actas: null,
  tiempoViajeMin: 60,
  ultimoGps: min(-1),
  ...extra,
});
const jornada = (unidades: UnidadJornada[]): Jornada => ({ eventoId: 'ev-1', evento: 'E', unidades, noCdas: [], sinKit: [], sinDistributivo: false });

describe('JornadaAvisosService', () => {
  const cargar = jest.fn();
  const prisma = {
    avisoJornada: { findMany: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    alerta: { findMany: jest.fn() },
  };
  const telegram = {
    enviarHtml: jest.fn(),
    responderEn: jest.fn((_chat: string, fn: () => Promise<unknown>) => fn()),
  };
  let service: JornadaAvisosService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_CHAT_ID_JORNADA = CHAT;
    telegram.enviarHtml.mockResolvedValue(true);
    prisma.avisoJornada.findMany.mockResolvedValue([]);
    prisma.avisoJornada.createMany.mockImplementation(({ data }) => Promise.resolve({ count: data.length }));
    prisma.alerta.findMany.mockResolvedValue([]);
    cargar.mockResolvedValue(jornada([unidad('op-1')]));
    service = new JornadaAvisosService(
      prisma as unknown as PrismaService,
      { cargar } as unknown as JornadaService,
      telegram as unknown as TelegramNotifier,
    );
  });

  afterAll(() => {
    delete process.env.TELEGRAM_CHAT_ID_JORNADA;
  });

  it('aparta la clave, manda el aviso con sonido al grupo Jornada y no lo repite', async () => {
    await service.enviarPendientes(AHORA);
    expect(prisma.avisoJornada.findMany).toHaveBeenCalledWith({ where: { eventoId: 'ev-1', dia: '2026-11-29' }, select: { clave: true } });
    expect(prisma.avisoJornada.createMany).toHaveBeenCalledWith({
      data: [{ eventoId: 'ev-1', dia: '2026-11-29', clave: 'RETRASO_IDA:op-1' }],
      skipDuplicates: true,
    });
    expect(telegram.responderEn).toHaveBeenCalledWith(CHAT, expect.any(Function));
    expect(telegram.enviarHtml).toHaveBeenCalledWith(expect.stringContaining('Retraso al recinto'), expect.any(String), undefined, { silencioso: false });

    // Ya guardado (p. ej. tras un reinicio): no se manda otra vez.
    jest.clearAllMocks();
    prisma.avisoJornada.findMany.mockResolvedValue([{ clave: 'RETRASO_IDA:op-1' }]);
    await service.enviarPendientes(min(1));
    expect(telegram.enviarHtml).not.toHaveBeenCalled();
  });

  it('reenvía las alertas del día del evento (solo los tipos elegidos)', async () => {
    cargar.mockResolvedValue(jornada([]));
    prisma.alerta.findMany.mockResolvedValue([
      { id: 'a1', tipo: 'NO_LLEGO_RECINTO', mensaje: 'No llegó', generadaEn: min(-3), operadorId: null },
    ]);
    await service.enviarPendientes(AHORA);
    const where = prisma.alerta.findMany.mock.calls[0][0].where;
    expect(where.eventoId).toBe('ev-1');
    expect(where.tipo.in).toContain('KIT_NO_CORRESPONDE');
    expect(where.generadaEn.gte).toEqual(new Date('2026-11-29T09:00:00Z'));
    expect(telegram.enviarHtml.mock.calls[0][0]).toContain('No llegó al recinto');
  });

  it('si Telegram falla, libera las claves para reintentar y espera unos minutos', async () => {
    telegram.enviarHtml.mockResolvedValue(false);
    await service.enviarPendientes(AHORA);
    expect(prisma.avisoJornada.deleteMany).toHaveBeenCalledWith({
      where: { eventoId: 'ev-1', dia: '2026-11-29', clave: { in: ['RETRASO_IDA:op-1'] } },
    });
    telegram.enviarHtml.mockResolvedValue(true);
    await service.enviarPendientes(min(1));
    expect(telegram.enviarHtml).toHaveBeenCalledTimes(1);
    await service.enviarPendientes(min(3));
    expect(telegram.enviarHtml).toHaveBeenCalledTimes(2);
  });

  it(`rechazado ${FALLOS_PARA_DESCARTAR} veces seguidas: se descarta y deja pasar a los demás`, async () => {
    telegram.enviarHtml.mockResolvedValue(false);
    for (let i = 0; i < FALLOS_PARA_DESCARTAR; i++) await service.enviarPendientes(min(i * 3));
    // Las dos primeras veces se liberó; la tercera queda apartada.
    expect(prisma.avisoJornada.deleteMany).toHaveBeenCalledTimes(FALLOS_PARA_DESCARTAR - 1);
  });

  it('las alertas ya reenviadas se excluyen en la consulta', async () => {
    prisma.avisoJornada.findMany.mockResolvedValue([{ clave: 'ALERTA:a1' }, { clave: 'RETRASO_IDA:op-1' }]);
    await service.enviarPendientes(AHORA);
    expect(prisma.alerta.findMany.mock.calls[0][0].where.id).toEqual({ notIn: ['a1'] });
  });

  it('otra instancia ya apartó el aviso: no se duplica', async () => {
    prisma.avisoJornada.createMany.mockResolvedValue({ count: 0 });
    await service.enviarPendientes(AHORA);
    expect(telegram.enviarHtml).not.toHaveBeenCalled();
  });

  it(`a lo más ${MAX_AVISOS_POR_VUELTA} avisos por vuelta (arranque a media jornada)`, async () => {
    cargar.mockResolvedValue(jornada(Array.from({ length: 30 }, (_, i) => unidad(`op-${i}`))));
    await service.enviarPendientes(AHORA);
    const apartadas = prisma.avisoJornada.createMany.mock.calls.flatMap(([a]) => a.data);
    expect(apartadas).toHaveLength(MAX_AVISOS_POR_VUELTA);
  });

  it('sin grupo Jornada configurado o sin evento activo: no hace nada', async () => {
    delete process.env.TELEGRAM_CHAT_ID_JORNADA;
    await service.enviarPendientes(AHORA);
    expect(cargar).not.toHaveBeenCalled();
    process.env.TELEGRAM_CHAT_ID_JORNADA = CHAT;
    cargar.mockResolvedValue(null);
    await service.enviarPendientes(AHORA);
    expect(prisma.avisoJornada.findMany).not.toHaveBeenCalled();
  });

  it('con el interruptor de crons apagado (local) no revisa nada', async () => {
    process.env.ENLACES_CRON_ENABLED = 'false';
    await service.cadaMinuto();
    expect(cargar).not.toHaveBeenCalled();
    delete process.env.ENLACES_CRON_ENABLED;
  });
});
