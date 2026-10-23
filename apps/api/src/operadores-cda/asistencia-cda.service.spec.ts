import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as ExcelJS from 'exceljs';

import { AsistenciaCdaService } from './asistencia-cda.service';
import { PrismaService } from '../db/prisma.service';

const OP = '11111111-2222-4333-8444-555555555555';
const USR = '99999999-2222-4333-8444-555555555555';
// 22-oct-2026 14:00 en Ecuador.
const AHORA = new Date('2026-10-22T19:00:00Z');
const HOY = new Date('2026-10-22T00:00:00Z');

const operador = (over: Record<string, unknown> = {}) => ({
  id: OP,
  numero: 1,
  apellidosNombres: 'PÉREZ LÓPEZ ANA MARÍA',
  cedula: '1710034065',
  telefono: '0987923273',
  cargo: 'OPERADOR CDA',
  unidad: null,
  fechaInicio: new Date('2026-10-20T00:00:00Z'),
  fotoKey: null,
  activo: true,
  creadoEn: new Date('2026-10-20T10:00:00Z'),
  ...over,
});

const ANA_TECNICA = { nombres: 'Ana', apellidos: 'Técnica' };

describe('AsistenciaCdaService', () => {
  let service: AsistenciaCdaService;

  const prisma = {
    operadorCda: { findMany: jest.fn(), findUnique: jest.fn() },
    asistenciaCda: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: AHORA, doNotFake: ['nextTick', 'setImmediate'] });
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    const moduleRef = await Test.createTestingModule({
      providers: [AsistenciaCdaService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AsistenciaCdaService);
  });

  afterEach(() => jest.useRealTimers());

  describe('dia', () => {
    it('lista a todos los activos con sus marcas de hoy y quién las hizo', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([operador(), operador({ id: 'o2', cedula: '1002003000' })]);
      prisma.asistenciaCda.findMany.mockResolvedValueOnce([
        { operadorId: OP, entradaEn: new Date('2026-10-22T13:05:00Z'), entradaPor: ANA_TECNICA, salidaEn: null, salidaPor: null },
      ]);

      const r = await service.dia();

      expect(r.fecha).toBe('2026-10-22');
      expect(r.esHoy).toBe(true);
      expect(prisma.asistenciaCda.findMany.mock.calls[0][0].where).toEqual({ fecha: HOY });
      expect(r.filas[0]).toMatchObject({ entradaEn: '2026-10-22T13:05:00.000Z', entradaPor: 'Ana Técnica', salidaEn: null });
      expect(r.filas[1]).toMatchObject({ entradaEn: null, entradaPor: null });
    });

    it('un día pasado no es "hoy"; un día futuro o inválido se rechaza', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([]);
      prisma.asistenciaCda.findMany.mockResolvedValue([]);
      expect((await service.dia('2026-10-21')).esHoy).toBe(false);
      await expect(service.dia('2026-10-23')).rejects.toThrow('día futuro');
      await expect(service.dia('2026-02-30')).rejects.toThrow(BadRequestException);
    });
  });

  describe('marcar', () => {
    beforeEach(() => {
      prisma.operadorCda.findUnique.mockResolvedValue(operador());
      prisma.asistenciaCda.upsert.mockResolvedValue({ id: 'a1' });
    });

    it('marca la entrada de hoy solo si no estaba marcada, con hora y usuario', async () => {
      prisma.asistenciaCda.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.asistenciaCda.findUniqueOrThrow.mockResolvedValueOnce({
        entradaEn: AHORA, entradaPor: ANA_TECNICA, salidaEn: null, salidaPor: null,
      });

      const r = await service.marcar(OP, 'ENTRADA', USR);

      expect(prisma.asistenciaCda.upsert.mock.calls[0][0].where).toEqual({ operadorId_fecha: { operadorId: OP, fecha: HOY } });
      expect(prisma.asistenciaCda.updateMany).toHaveBeenCalledWith({
        where: { id: 'a1', entradaEn: null },
        data: { entradaEn: AHORA, entradaPorId: USR },
      });
      expect(r).toMatchObject({ entradaPor: 'Ana Técnica', entradaEn: AHORA.toISOString() });
    });

    it('si otro técnico ya marcó la entrada, responde 409 diciendo a qué hora y quién (no la pisa)', async () => {
      prisma.asistenciaCda.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.asistenciaCda.findUniqueOrThrow.mockResolvedValueOnce({
        entradaEn: new Date('2026-10-22T13:05:00Z'), entradaPor: ANA_TECNICA, salidaEn: null, salidaPor: null,
      });

      await expect(service.marcar(OP, 'ENTRADA', USR)).rejects.toThrow(
        'La entrada de hoy ya estaba registrada a las 08:05 por Ana Técnica',
      );
    });

    it('la salida exige que ya exista la entrada', async () => {
      prisma.asistenciaCda.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.asistenciaCda.findUniqueOrThrow.mockResolvedValueOnce({ entradaEn: null, entradaPor: null, salidaEn: null, salidaPor: null });

      await expect(service.marcar(OP, 'SALIDA', USR)).rejects.toThrow('Primero registre la entrada de hoy');
      expect(prisma.asistenciaCda.updateMany.mock.calls[0][0].where).toEqual({ id: 'a1', entradaEn: { not: null }, salidaEn: null });
    });

    it('no marca a un operador inactivo o inexistente', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(operador({ activo: false }));
      await expect(service.marcar(OP, 'ENTRADA', USR)).rejects.toThrow(NotFoundException);
      prisma.operadorCda.findUnique.mockResolvedValueOnce(null);
      await expect(service.marcar(OP, 'ENTRADA', USR)).rejects.toThrow(NotFoundException);
      expect(prisma.asistenciaCda.upsert).not.toHaveBeenCalled();
    });
  });

  describe('deshacer', () => {
    it('quita la salida de hoy y devuelve la marca quitada (para la bitácora)', async () => {
      prisma.asistenciaCda.findUnique.mockResolvedValueOnce({ id: 'a1', entradaEn: AHORA, salidaEn: AHORA, salidaPorId: USR });
      prisma.asistenciaCda.updateMany.mockResolvedValueOnce({ count: 1 });

      await expect(service.deshacer(OP, 'SALIDA')).resolves.toEqual({
        deshecho: true,
        marcaEn: AHORA.toISOString(),
        marcadaPorId: USR,
      });
      expect(prisma.asistenciaCda.updateMany).toHaveBeenCalledWith({
        where: { id: 'a1', salidaEn: AHORA },
        data: { salidaEn: null, salidaPorId: null },
      });
    });

    it('no quita la entrada si ya hay salida', async () => {
      prisma.asistenciaCda.findUnique.mockResolvedValueOnce({ id: 'a1', entradaEn: AHORA, salidaEn: AHORA });
      prisma.asistenciaCda.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.deshacer(OP, 'ENTRADA')).rejects.toThrow('Primero quite la salida de hoy');
    });

    it('"Deshacer" no quita una marca distinta a la que se vio (otro técnico la cambió)', async () => {
      prisma.asistenciaCda.findUnique.mockResolvedValueOnce({ id: 'a1', entradaEn: AHORA, salidaEn: null });
      await expect(service.deshacer(OP, 'ENTRADA', '2026-10-22T13:00:00.000Z')).rejects.toThrow('La marca cambió');
      expect(prisma.asistenciaCda.updateMany).not.toHaveBeenCalled();

      // Si cambia entre la lectura y el borrado, el updateMany condicionado no afecta nada.
      prisma.asistenciaCda.findUnique.mockResolvedValueOnce({ id: 'a1', entradaEn: AHORA, salidaEn: null });
      prisma.asistenciaCda.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.deshacer(OP, 'ENTRADA', AHORA.toISOString())).rejects.toThrow(ConflictException);
      expect(prisma.asistenciaCda.updateMany.mock.calls[0][0].where).toEqual({ id: 'a1', entradaEn: AHORA, salidaEn: null });
    });

    it('404 si no hay esa marca hoy', async () => {
      prisma.asistenciaCda.findUnique.mockResolvedValueOnce(null);
      await expect(service.deshacer(OP, 'ENTRADA')).rejects.toThrow('No hay entrada registrada hoy');
      prisma.asistenciaCda.findUnique.mockResolvedValueOnce({ id: 'a1', entradaEn: AHORA, salidaEn: null });
      await expect(service.deshacer(OP, 'SALIDA')).rejects.toThrow('No hay salida registrada hoy');
    });
  });

  describe('marcarMasiva', () => {
    it('crea las filas que faltan y marca entrada solo a activos sin entrada', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([{ id: OP }]);
      prisma.asistenciaCda.updateMany.mockResolvedValueOnce({ count: 1 });

      const r = await service.marcarMasiva('ENTRADA', [OP, OP, 'inactivo'], USR);

      expect(prisma.asistenciaCda.createMany).toHaveBeenCalledWith({
        data: [{ operadorId: OP, fecha: HOY }],
        skipDuplicates: true,
      });
      expect(prisma.asistenciaCda.updateMany.mock.calls[0][0].where).toEqual({
        fecha: HOY,
        operadorId: { in: [OP] },
        entradaEn: null,
      });
      // 'inactivo' no es un operador activo: se cuenta aparte.
      expect(r).toEqual({ marcados: 1, omitidos: 0, ignorados: 1 });
    });

    it('la salida masiva solo afecta a quienes tienen entrada y no salida', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([{ id: OP }]);
      prisma.asistenciaCda.updateMany.mockResolvedValueOnce({ count: 0 });

      const r = await service.marcarMasiva('SALIDA', [OP], USR);

      expect(prisma.asistenciaCda.createMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.asistenciaCda.updateMany.mock.calls[0][0].where).toMatchObject({ entradaEn: { not: null }, salidaEn: null });
      expect(r).toEqual({ marcados: 0, omitidos: 1, ignorados: 0 });
    });
  });

  describe('exportar', () => {
    it('una fila por operador y día desde su fecha de inicio, con horas de Ecuador y estado', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([
        operador(),
        operador({ id: 'o2', apellidosNombres: 'RUIZ MORA JUAN', cedula: '1002003000', fechaInicio: new Date('2026-10-22T00:00:00Z') }),
      ]);
      prisma.asistenciaCda.findMany.mockResolvedValueOnce([
        {
          operadorId: OP,
          fecha: new Date('2026-10-21T00:00:00Z'),
          entradaEn: new Date('2026-10-21T13:00:00Z'),
          entradaPor: ANA_TECNICA,
          salidaEn: new Date('2026-10-21T23:30:00Z'),
          salidaPor: ANA_TECNICA,
        },
      ]);

      const buf = await service.exportar(undefined, '2026-10-22');

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as any);
      const filas = wb.worksheets[0].getSheetValues().slice(2) as unknown[][];
      // Ana desde el 20 (3 días) + Juan solo el 22 = 4 filas.
      expect(filas).toHaveLength(4);
      expect(filas[1]).toEqual([
        undefined, '2026-10-21', 'PÉREZ LÓPEZ ANA MARÍA', '1710034065', '08:00', 'Ana Técnica', '18:30', 'Ana Técnica', 'Completa',
      ]);
      expect(filas[0][8]).toBe('Sin registro');
      expect(filas.map((f) => f[1])).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-22']);
    });

    it('rechaza rangos invertidos, demasiado largos o con fecha final futura', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([]);
      await expect(service.exportar('2026-10-22', '2026-10-20')).rejects.toThrow('posterior');
      await expect(service.exportar('2026-01-01', '2026-10-20')).rejects.toThrow('demasiado largo');
      await expect(service.exportar(undefined, '2026-10-23')).rejects.toThrow('no puede ser futura');
    });

    it('sin "desde" y con operadores de hace más de 120 días, exporta solo los últimos 120 días', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([operador({ fechaInicio: new Date('2026-01-05T00:00:00Z') })]);
      prisma.asistenciaCda.findMany.mockResolvedValueOnce([]);

      const buf = await service.exportar(undefined, '2026-10-22');

      expect(prisma.asistenciaCda.findMany.mock.calls[0][0].where.fecha).toEqual({
        gte: new Date('2026-06-25T00:00:00Z'),
        lte: new Date('2026-10-22T00:00:00Z'),
      });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as any);
      expect(wb.worksheets[0].rowCount).toBe(121);
    });
  });
});
