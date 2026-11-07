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

const persona = (id: string, apellidosNombres: string, grupo: string) => ({
  id,
  apellidosNombres,
  cedula: '1710034065',
  grupo,
  activo: true,
  cargoCda: { nombre: grupo === 'DIGITADOR' ? 'Digitadores' : 'Operadores CDA' },
});

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
    { incluida: true, operador: persona(P1, 'ANA PÉREZ', 'OPERADOR') },
    { incluida: false, operador: persona(P2, 'LUIS MORA', 'DIGITADOR') },
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
    operadorCda: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    cargoCda: { findMany: jest.fn() },
    intentoDigitacion: { findMany: jest.fn(), findUnique: jest.fn() },
    actaDigitacion: { findMany: jest.fn() },
    novedadDigitacion: { findMany: jest.fn(), findFirst: jest.fn(), aggregate: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  let service: PracticasDigitacionService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
    prisma.practicaDigitacion.findUnique.mockResolvedValue(fila());
    service = new PracticasDigitacionService(prisma as unknown as PrismaService);
  });

  it('obtener: personas con nombre y cargo, y a cuántas aplica', async () => {
    prisma.operadorCda.count.mockResolvedValue(41);
    const p = await service.obtener(ID);
    expect(p).toMatchObject({ id: ID, cargos: ['DIGITADOR'], intentos: 0, inicio: INPUT.inicio, alcance: 41 });
    expect(p.personas).toEqual([
      { id: P1, apellidosNombres: 'ANA PÉREZ', cedula: '1710034065', grupo: 'OPERADOR', cargo: 'Operadores CDA', activo: true, incluida: true },
      { id: P2, apellidosNombres: 'LUIS MORA', cedula: '1710034065', grupo: 'DIGITADOR', cargo: 'Digitadores', activo: true, incluida: false },
    ]);
    // Alcance: activos de los cargos sin los quitados, más los agregados.
    expect(prisma.operadorCda.count).toHaveBeenCalledWith({
      where: { activo: true, OR: [{ grupo: { in: ['DIGITADOR'] }, id: { notIn: [P2] } }, { id: { in: [P1] } }] },
    });
  });

  it.each(['', '  ', 'a', ' 1 '])('buscarPersonas con menos de 2 caracteres (%p) no lista a nadie', async (q) => {
    await expect(service.buscarPersonas(q)).resolves.toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.operadorCda.findMany).not.toHaveBeenCalled();
  });

  it('buscarPersonas: activos que coinciden, máximo 20', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: P1 }]);
    prisma.operadorCda.findMany.mockResolvedValue([persona(P1, 'ANA PÉREZ', 'OPERADOR')]);
    const r = await service.buscarPersonas('ana');
    expect(r).toEqual([{ id: P1, apellidosNombres: 'ANA PÉREZ', cedula: '1710034065', grupo: 'OPERADOR', cargo: 'Operadores CDA', activo: true }]);
    expect(prisma.operadorCda.findMany.mock.calls[0][0]).toMatchObject({ where: { activo: true, id: { in: [P1] } }, take: 20 });
  });

  it('listarCargos: solo activos, con su personal activo', async () => {
    prisma.cargoCda.findMany.mockResolvedValue([{ clave: 'DIGITADOR', nombre: 'Digitadores', centro: 'CPE' }, { clave: 'X', nombre: 'X', centro: 'CDA' }]);
    prisma.operadorCda.groupBy.mockResolvedValue([{ grupo: 'DIGITADOR', _count: { _all: 30 } }]);
    await expect(service.listarCargos()).resolves.toEqual([
      { clave: 'DIGITADOR', nombre: 'Digitadores', centro: 'CPE', personas: 30 },
      { clave: 'X', nombre: 'X', centro: 'CDA', personas: 0 },
    ]);
    expect(prisma.cargoCda.findMany.mock.calls[0][0].where).toEqual({ activo: true });
  });

  describe('reporte', () => {
    const AHORA = new Date('2026-11-10T16:00:00Z');
    const intentoBd = (o: Record<string, unknown>) => ({
      id: 'i1',
      operadorId: P1,
      numero: 1,
      cargo: 'Digitadores',
      iniciadoEn: new Date('2026-11-10T14:00:00Z'),
      venceEn: new Date('2026-11-10T15:00:00Z'),
      terminadoEn: null,
      actasCompletadas: 5,
      actasPerfectas: 4,
      filasDigitadas: 60,
      filasCorrectas: 58,
      ...o,
    });
    const datos = (id: string, apellidosNombres: string, telefono: string | null) => ({
      id,
      cedula: '1710034065',
      apellidosNombres,
      telefono,
      cargoCda: { nombre: 'Digitadores' },
    });

    beforeEach(() => {
      // 1.ª llamada: asignadas hoy; 2.ª: los datos de todas.
      prisma.operadorCda.findMany
        .mockResolvedValueOnce([{ id: P1 }, { id: P2 }])
        .mockResolvedValueOnce([datos(P1, 'ANA PÉREZ', '0991234567'), datos(P2, 'LUIS MORA', null), datos(ID, 'YA NO ASIGNADA', null)]);
      prisma.intentoDigitacion.findMany.mockResolvedValue([
        intentoBd({}),
        intentoBd({ id: 'i2', numero: 2, filasDigitadas: 70, filasCorrectas: 69 }),
        intentoBd({ id: 'i3', operadorId: ID }),
      ]);
      prisma.actaDigitacion.findMany.mockResolvedValue([{ intentoId: 'i2', valores: [1, 2, 3], borrador: [1, 2, 9] }]);
    });

    it('asignadas (aunque no se presenten) + quien tiene intentos; suma el acta a medias; ordena', async () => {
      const r = await service.reporte(ID, AHORA);
      expect(prisma.operadorCda.findMany).toHaveBeenNthCalledWith(1, {
        where: { activo: true, OR: [{ grupo: { in: ['DIGITADOR'] }, id: { notIn: [P2] } }, { id: { in: [P1] } }] },
        select: { id: true },
      });
      expect(prisma.operadorCda.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: { in: [P1, P2, ID] } } }));
      expect(prisma.actaDigitacion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { intento: { practicaId: ID }, guardados: 0, completadaEn: null } }),
      );
      expect(r.filas.map((f) => [f.apellidosNombres, f.estado, f.asignada, f.mejor])).toEqual([
        ['ANA PÉREZ', 'TERMINADO', true, 2],
        ['YA NO ASIGNADA', 'TERMINADO', false, 1],
        ['LUIS MORA', 'NO_SE_PRESENTO', true, null],
      ]);
      // Intento 2: 70 + 3 del acta a medias, 69 + 2 correctos.
      expect(r.filas[0].intentos[1]).toMatchObject({ filasDigitadas: 73, filasCorrectas: 71, motivo: 'TIEMPO' });
      expect(r.filas[0].telefono).toBe('0991234567');
      expect(r.totales).toEqual({ personas: 3, presentaron: 2, cumplieron: 0, enCurso: 0, noSePresentaron: 1 });
      expect(r.practica).toMatchObject({ id: ID, metaActas: 200, inicio: INPUT.inicio });
      expect(r.generadoEn).toBe(AHORA.toISOString());
    });

    it('práctica inexistente: 404', async () => {
      prisma.practicaDigitacion.findUnique.mockResolvedValue(null);
      await expect(service.reporte(ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('el intento anulado se muestra con su motivo, pero no puede ser el mejor', async () => {
      prisma.intentoDigitacion.findMany.mockResolvedValue([
        intentoBd({}),
        intentoBd({ id: 'i2', numero: 2, filasDigitadas: 70, filasCorrectas: 69, anuladoEn: AHORA, motivoAnulacion: 'Cerró el navegador' }),
      ]);
      const r = await service.reporte(ID, AHORA);
      const ana = r.filas.find((f) => f.apellidosNombres === 'ANA PÉREZ')!;
      expect(ana.mejor).toBe(1);
      expect(ana.intentos[1]).toMatchObject({ id: 'i2', anulado: true, motivoAnulacion: 'Cerró el navegador', cumplio: false });
    });
  });

  describe('anularIntento', () => {
    const AHORA = new Date('2026-11-10T14:20:00Z');
    const USUARIO = '44444444-4444-4444-8444-444444444444';
    const abierto = { id: 'i1', practicaId: ID, operadorId: P1, anuladoEn: null as Date | null };
    /** El SQL y sus valores, para revisar la sentencia sin base. */
    const sentencia = () => {
      const [partes, ...valores] = prisma.$executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      return { sql: partes.join('?').replace(/\s+/g, ' '), valores };
    };

    it('guarda quién, cuándo y por qué en una sola sentencia que no pisa la hora de fin', async () => {
      prisma.intentoDigitacion.findUnique.mockResolvedValue(abierto);
      prisma.$executeRaw.mockResolvedValue(1);
      const r = await service.anularIntento('i1', 'Cerró el navegador', USUARIO, AHORA);
      const { sql, valores } = sentencia();
      expect(sql).toContain('"terminado_en" = COALESCE("terminado_en", LEAST("vence_en", ?))');
      expect(sql).toContain('AND "anulado_en" IS NULL');
      expect(valores).toEqual([AHORA, USUARIO, 'Cerró el navegador', AHORA, 'i1']);
      expect(r).toEqual({ id: 'i1', practicaId: ID, operadorId: P1, anuladoEn: AHORA.toISOString() });
    });

    it('inexistente: 404; ya anulado (o anulado a la vez por otro): 409', async () => {
      prisma.intentoDigitacion.findUnique.mockResolvedValueOnce(null);
      await expect(service.anularIntento('i1', 'motivo largo', USUARIO, AHORA)).rejects.toBeInstanceOf(NotFoundException);
      prisma.intentoDigitacion.findUnique.mockResolvedValueOnce({ ...abierto, anuladoEn: AHORA });
      await expect(service.anularIntento('i1', 'motivo largo', USUARIO, AHORA)).rejects.toThrow('ya estaba anulado');
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      prisma.intentoDigitacion.findUnique.mockResolvedValueOnce(abierto);
      prisma.$executeRaw.mockResolvedValueOnce(0);
      await expect(service.anularIntento('i1', 'motivo largo', USUARIO, AHORA)).rejects.toThrow('ya estaba anulado');
    });
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
