import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PracticaDigitacionInput } from '@cne/shared-validation';

import { PracticasDigitacionService } from './practicas-digitacion.service';
import type { PrismaService } from '../db/prisma.service';

const ID = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';

const INPUT: PracticaDigitacionInput = {
  nombre: 'Práctica 1',
  filasPorActa: 12,
  votoMin: 0,
  votoMax: 350,
  metaActas: 200,
  plazoMinutos: 60,
  inicio: '2026-11-10T13:00:00.000Z',
  fin: '2026-11-10T18:00:00.000Z',
  pctDigitosDistintos: 10,
  intentosMax: 2,
  cargos: ['DIGITADOR'],
  incluir: [P1],
  excluir: [P2],
};

const fila = (intentos = 0, o: Record<string, unknown> = {}) => ({
  id: ID,
  ...INPUT,
  inicio: new Date(INPUT.inicio),
  fin: new Date(INPUT.fin),
  activa: true,
  creadoEn: new Date('2026-11-05T12:00:00Z'),
  actualizadoEn: new Date('2026-11-05T12:00:00Z'),
  cargos: [{ cargo: 'DIGITADOR' }],
  personas: [
    { operadorId: P1, incluida: true },
    { operadorId: P2, incluida: false },
  ],
  _count: { intentos },
  ...o,
});

const errorPrisma = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'x' });

describe('PracticasDigitacionService', () => {
  const prisma = {
    practicaDigitacion: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    practicaDigitacionCargo: { createMany: jest.fn(), deleteMany: jest.fn() },
    practicaDigitacionPersona: { createMany: jest.fn(), deleteMany: jest.fn() },
    novedadDigitacion: { findMany: jest.fn(), findFirst: jest.fn(), aggregate: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  let service: PracticasDigitacionService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
    prisma.practicaDigitacion.findUnique.mockResolvedValue(fila());
    service = new PracticasDigitacionService(prisma as unknown as PrismaService);
  });

  it('obtener: separa personas agregadas y quitadas', async () => {
    const p = await service.obtener(ID);
    expect(p).toMatchObject({ id: ID, cargos: ['DIGITADOR'], incluir: [P1], excluir: [P2], intentos: 0, inicio: INPUT.inicio });
  });

  it('obtener inexistente: 404', async () => {
    prisma.practicaDigitacion.findUnique.mockResolvedValue(null);
    await expect(service.obtener(ID)).rejects.toThrow(NotFoundException);
  });

  it('crear: práctica, cargos y excepciones en una sola transacción', async () => {
    prisma.practicaDigitacion.create.mockResolvedValue({ id: ID });
    await service.crear(INPUT);
    expect(prisma.practicaDigitacion.create.mock.calls[0][0].data).toMatchObject({ nombre: 'Práctica 1', inicio: new Date(INPUT.inicio) });
    expect(prisma.practicaDigitacionCargo.createMany).toHaveBeenCalledWith({ data: [{ practicaId: ID, cargo: 'DIGITADOR' }] });
    expect(prisma.practicaDigitacionPersona.createMany).toHaveBeenCalledWith({
      data: [
        { practicaId: ID, operadorId: P1, incluida: true },
        { practicaId: ID, operadorId: P2, incluida: false },
      ],
    });
  });

  it('crear con un cargo o persona inexistente: 400', async () => {
    prisma.practicaDigitacion.create.mockResolvedValue({ id: ID });
    prisma.practicaDigitacionCargo.createMany.mockRejectedValue(errorPrisma('P2003'));
    await expect(service.crear(INPUT)).rejects.toThrow(BadRequestException);
  });

  it('editar sin intentos: reemplaza todo', async () => {
    await service.editar(ID, { ...INPUT, metaActas: 1000, cargos: [], incluir: [P1], excluir: [] });
    expect(prisma.practicaDigitacion.update.mock.calls[0][0].data).toMatchObject({ metaActas: 1000 });
    expect(prisma.practicaDigitacionCargo.deleteMany).toHaveBeenCalledWith({ where: { practicaId: ID } });
    expect(prisma.practicaDigitacionCargo.createMany).not.toHaveBeenCalled();
    expect(prisma.practicaDigitacionPersona.createMany).toHaveBeenCalledWith({ data: [{ practicaId: ID, operadorId: P1, incluida: true }] });
  });

  it.each(['filasPorActa', 'votoMin', 'votoMax', 'metaActas', 'plazoMinutos', 'pctDigitosDistintos'] as const)(
    'con intentos no se cambia %s',
    async (campo) => {
      prisma.practicaDigitacion.findUnique.mockResolvedValue(fila(3));
      await expect(service.editar(ID, { ...INPUT, [campo]: INPUT[campo] + 1 })).rejects.toThrow(ConflictException);
      expect(prisma.practicaDigitacion.update).not.toHaveBeenCalled();
    },
  );

  it('con intentos sí cambian nombre, ventana, intentos y a quién aplica', async () => {
    prisma.practicaDigitacion.findUnique.mockResolvedValue(fila(3));
    await service.editar(ID, { ...INPUT, nombre: 'Otro', fin: '2026-11-11T18:00:00.000Z', intentosMax: 5, cargos: ['OPERADOR'] });
    expect(prisma.practicaDigitacion.update).toHaveBeenCalled();
  });

  it('editar bloquea la fila de la práctica y revisa los intentos dentro de la transacción', async () => {
    const orden: string[] = [];
    prisma.$queryRaw.mockImplementation(() => (orden.push('lock'), Promise.resolve([])));
    prisma.practicaDigitacion.findUnique.mockImplementation(() => (orden.push('leer'), Promise.resolve(fila())));
    prisma.practicaDigitacion.update.mockImplementation(() => (orden.push('update'), Promise.resolve({})));
    await service.editar(ID, INPUT);
    expect(orden.slice(0, 3)).toEqual(['lock', 'leer', 'update']);
    expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
  });

  it('editar inexistente: 404', async () => {
    prisma.practicaDigitacion.findUnique.mockResolvedValue(null);
    await expect(service.editar(ID, INPUT)).rejects.toThrow(NotFoundException);
  });

  it('cambiarActiva inexistente: 404', async () => {
    prisma.practicaDigitacion.update.mockRejectedValue(errorPrisma('P2025'));
    await expect(service.cambiarActiva(ID, false)).rejects.toThrow(NotFoundException);
  });

  describe('novedades', () => {
    it('crear: al final del orden', async () => {
      prisma.novedadDigitacion.findFirst.mockResolvedValue(null);
      prisma.novedadDigitacion.aggregate.mockResolvedValue({ _max: { orden: 4 } });
      prisma.novedadDigitacion.create.mockResolvedValue({});
      await service.crearNovedad('Acta ilegible');
      expect(prisma.novedadDigitacion.create).toHaveBeenCalledWith({ data: { nombre: 'Acta ilegible', orden: 5 } });
    });

    it('nombre repetido sin importar mayúsculas: 409', async () => {
      prisma.novedadDigitacion.findFirst.mockResolvedValue({ id: 'x' });
      await expect(service.crearNovedad('ACTA ILEGIBLE')).rejects.toThrow(ConflictException);
      expect(prisma.novedadDigitacion.findFirst.mock.calls[0][0].where).toEqual({ nombre: { equals: 'ACTA ILEGIBLE', mode: 'insensitive' } });
    });

    it('renombrar: no choca consigo misma', async () => {
      prisma.novedadDigitacion.findFirst.mockResolvedValue(null);
      prisma.novedadDigitacion.update.mockResolvedValue({});
      await service.renombrarNovedad(ID, 'Nuevo');
      expect(prisma.novedadDigitacion.findFirst.mock.calls[0][0].where).toEqual({ nombre: { equals: 'Nuevo', mode: 'insensitive' }, id: { not: ID } });
    });
  });
});
