import type { Jornada, UnidadJornada } from './jornada';
import type { JornadaService } from './jornada.service';
import { MAX_RECORDATORIOS_POR_VUELTA, RecordatoriosEtapaService } from './recordatorios-etapa.service';
import type { PrismaService } from '../../db/prisma.service';

// 15:00 UTC = 10:00 en Ecuador; día de jornada 2026-11-29.
const AHORA = new Date('2026-11-29T15:00:00Z');
const min = (n: number) => new Date(AHORA.getTime() + n * 60_000);

const unidad = (operadorId: string, destinatarios: string[]): UnidadJornada => ({
  operadorId,
  codigoRecinto: operadorId,
  nombreRecinto: `Recinto ${operadorId}`,
  tecnico: { numero: 1, nombre: 'Jairo' },
  canton: { codigo: 30, nombre: 'IBARRA' },
  personas: [],
  // Salió hace 70 min con 60 de viaje: la llegada al recinto lleva 10 min vencida.
  registros: { SALIDA_DPI: { en: min(-70), sinSenal: false } },
  kitRecibido: null,
  kitEscaneado: null,
  actas: null,
  tiempoViajeMin: 60,
  ultimoGps: null,
  destinatarios,
});
const jornada = (unidades: UnidadJornada[]): Jornada => ({
  eventoId: 'ev-1',
  evento: 'E',
  unidades,
  noCdas: [],
  sinKit: [],
  sinDistributivo: false,
});

describe('RecordatoriosEtapaService', () => {
  const cargar = jest.fn();
  const prisma = {
    avisoJornada: { findMany: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    notificacion: { createMany: jest.fn() },
  };
  let service: RecordatoriosEtapaService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.avisoJornada.findMany.mockResolvedValue([]);
    prisma.avisoJornada.createMany.mockImplementation(({ data }) => Promise.resolve({ count: data.length }));
    prisma.notificacion.createMany.mockResolvedValue({ count: 0 });
    cargar.mockResolvedValue(jornada([unidad('op-1', ['op-1', 'asis-1'])]));
    service = new RecordatoriosEtapaService(prisma as unknown as PrismaService, { cargar } as unknown as JornadaService);
  });

  it('sin evento activo no hace nada', async () => {
    cargar.mockResolvedValue(null);
    expect(await service.enviarPendientes(AHORA)).toBe(0);
    expect(prisma.notificacion.createMany).not.toHaveBeenCalled();
  });

  it('crea una notificación in-app para el operador y su pareja, con el texto de la etapa', async () => {
    expect(await service.enviarPendientes(AHORA)).toBe(1);

    expect(prisma.avisoJornada.createMany).toHaveBeenCalledWith({
      data: [{ eventoId: 'ev-1', dia: '2026-11-29', clave: 'ETAPA:LLEGADA_RECINTO:op-1:0' }],
      skipDuplicates: true,
    });
    const filas = prisma.notificacion.createMany.mock.calls[0][0].data;
    expect(filas.map((f: { usuarioId: string }) => f.usuarioId)).toEqual(['op-1', 'asis-1']);
    expect(filas[0]).toMatchObject({ tipoEvento: 'Falta registrar: llegada al recinto', canal: 'PUSH' });
    expect(filas[0].tipoEvento.length).toBeLessThanOrEqual(60);
  });

  it('no repite lo ya avisado (clave guardada)', async () => {
    prisma.avisoJornada.findMany.mockResolvedValue([{ clave: 'ETAPA:LLEGADA_RECINTO:op-1:0' }]);
    expect(await service.enviarPendientes(AHORA)).toBe(0);
    expect(prisma.notificacion.createMany).not.toHaveBeenCalled();
  });

  it('si otra instancia ya apartó la clave, no duplica la notificación', async () => {
    prisma.avisoJornada.createMany.mockResolvedValue({ count: 0 });
    expect(await service.enviarPendientes(AHORA)).toBe(0);
    expect(prisma.notificacion.createMany).not.toHaveBeenCalled();
  });

  it('si falla la creación de la notificación libera la clave y sigue con los demás', async () => {
    cargar.mockResolvedValue(jornada([unidad('op-1', ['op-1']), unidad('op-2', ['op-2'])]));
    prisma.notificacion.createMany.mockRejectedValueOnce(new Error('base caída')).mockResolvedValueOnce({ count: 1 });
    prisma.avisoJornada.deleteMany.mockResolvedValue({ count: 1 });

    expect(await service.enviarPendientes(AHORA)).toBe(1);

    expect(prisma.avisoJornada.deleteMany).toHaveBeenCalledWith({
      where: { eventoId: 'ev-1', dia: '2026-11-29', clave: 'ETAPA:LLEGADA_RECINTO:op-1:0' },
    });
    expect(prisma.notificacion.createMany).toHaveBeenCalledTimes(2);
  });

  it('no manda más de MAX_RECORDATORIOS_POR_VUELTA por vuelta', async () => {
    const muchas = Array.from({ length: MAX_RECORDATORIOS_POR_VUELTA + 5 }, (_, i) => unidad(`op-${i}`, [`op-${i}`]));
    cargar.mockResolvedValue(jornada(muchas));
    expect(await service.enviarPendientes(AHORA)).toBe(MAX_RECORDATORIOS_POR_VUELTA);
  });

  it('el cron respeta ENLACES_CRON_ENABLED=false', async () => {
    process.env.ENLACES_CRON_ENABLED = 'false';
    await service.cadaCincoMinutos();
    expect(cargar).not.toHaveBeenCalled();
    delete process.env.ENLACES_CRON_ENABLED;
  });
});
