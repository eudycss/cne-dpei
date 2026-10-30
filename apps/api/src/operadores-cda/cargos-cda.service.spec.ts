import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { CargosCdaService } from './cargos-cda.service';
import { cargoActivo, parsearGrupo, registrarCargos, textosGrupo } from './grupo-cda';
import type { PrismaService } from '../db/prisma.service';

const fila = (clave: string, nombre: string, centro: 'CDA' | 'CPE', orden: number, activo = true) => ({
  clave,
  nombre,
  centro,
  orden,
  activo,
});

const TABLA = [
  fila('OPERADOR', 'Operadores CDA', 'CDA', 1),
  fila('ASISTENTE', 'Asistentes CDA', 'CDA', 2),
  fila('DIGITADOR', 'Digitadores', 'CPE', 3),
];

function errorUnico() {
  return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
}

describe('CargosCdaService', () => {
  const prisma = {
    cargoCda: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    operadorCda: { groupBy: jest.fn() },
  };
  let service: CargosCdaService;

  afterEach(() => service.onModuleDestroy());

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.cargoCda.findMany.mockResolvedValue(TABLA);
    prisma.cargoCda.findFirst.mockResolvedValue(null);
    prisma.cargoCda.aggregate.mockResolvedValue({ _max: { orden: 3 } });
    prisma.operadorCda.groupBy.mockResolvedValue([{ grupo: 'OPERADOR', _count: { _all: 31 } }]);
    service = new CargosCdaService(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    // Deja el registro como lo cargaría la base real (no contamina otras suites).
    const { GRUPOS_CDA } = await import('@cne/shared-validation');
    const { TEXTOS_GRUPO } = await import('./grupo-cda');
    registrarCargos(
      GRUPOS_CDA.map((clave) => ({
        clave,
        nombre: TEXTOS_GRUPO[clave].titulo,
        centro: TEXTOS_GRUPO[clave].cargo.endsWith(' CDA') ? 'CDA' : 'CPE',
        activo: true,
      })),
    );
  });

  it('listar: en orden, con personas activas, protegidos operadores y asistentes; refresca el registro', async () => {
    prisma.cargoCda.findMany.mockResolvedValue([...TABLA, fila('JEFES', 'Jefes de sala', 'CPE', 4, false)]);
    const r = await service.listar();
    expect(prisma.cargoCda.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ orden: 'asc' }, { clave: 'asc' }] }));
    expect(prisma.operadorCda.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['grupo'], where: { activo: true } }),
    );
    expect(r.map((c) => [c.clave, c.protegido, c.personas, c.activo])).toEqual([
      ['OPERADOR', true, 31, true],
      ['ASISTENTE', true, 0, true],
      ['DIGITADOR', false, 0, true],
      ['JEFES', false, 0, false],
    ]);
    expect(parsearGrupo('JEFES')).toBe('JEFES');
    expect(cargoActivo('JEFES')).toBe(false);
  });

  it('crear: clave a partir del nombre, al final del orden, y queda disponible en ?grupo=', async () => {
    prisma.cargoCda.create.mockImplementation(({ data }) => Promise.resolve({ ...data, activo: true }));
    prisma.cargoCda.findMany
      .mockResolvedValueOnce(TABLA) // claves existentes
      .mockResolvedValueOnce([...TABLA, fila('TECNICOS_DE_SALA', 'Técnicos de sala', 'CPE', 4)]);
    const r = await service.crear({ nombre: 'Técnicos de sala', centro: 'CPE' });
    expect(prisma.cargoCda.create).toHaveBeenCalledWith({
      data: { clave: 'TECNICOS_DE_SALA', nombre: 'Técnicos de sala', centro: 'CPE', orden: 4 },
    });
    expect(r).toMatchObject({ clave: 'TECNICOS_DE_SALA', protegido: false, personas: 0, activo: true });
    expect(parsearGrupo('TECNICOS_DE_SALA')).toBe('TECNICOS_DE_SALA');
    expect(textosGrupo('TECNICOS_DE_SALA').cargo).toBe('TÉCNICOS DE SALA CPE');
  });

  it('crear: nombre repetido (sin importar mayúsculas) es 409', async () => {
    prisma.cargoCda.findFirst.mockResolvedValue(fila('DIGITADOR', 'Digitadores', 'CPE', 3));
    await expect(service.crear({ nombre: 'DIGITADORES', centro: 'CPE' })).rejects.toThrow(ConflictException);
    expect(prisma.cargoCda.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { nombre: { equals: 'DIGITADORES', mode: 'insensitive' } } }),
    );
    expect(prisma.cargoCda.create).not.toHaveBeenCalled();
  });

  it('crear: si otro guardó el mismo nombre a la vez (índice único), también 409', async () => {
    prisma.cargoCda.create.mockRejectedValue(errorUnico());
    await expect(service.crear({ nombre: 'Jefes', centro: 'CPE' })).rejects.toThrow(ConflictException);
  });

  it('renombrar: cambia solo el nombre; 404 si no existe; 409 si otro cargo ya se llama así', async () => {
    prisma.cargoCda.findUnique.mockResolvedValue(fila('DIGITADOR', 'Digitadores', 'CPE', 3));
    prisma.cargoCda.update.mockResolvedValue(fila('DIGITADOR', 'Digitación', 'CPE', 3));
    await service.renombrar('DIGITADOR', { nombre: 'Digitación' });
    expect(prisma.cargoCda.update).toHaveBeenCalledWith({ where: { clave: 'DIGITADOR' }, data: { nombre: 'Digitación' } });
    expect(prisma.cargoCda.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { nombre: { equals: 'Digitación', mode: 'insensitive' }, clave: { not: 'DIGITADOR' } } }),
    );

    prisma.cargoCda.findUnique.mockResolvedValue(null);
    await expect(service.renombrar('NO_EXISTE', { nombre: 'X y Z' })).rejects.toThrow(NotFoundException);

    prisma.cargoCda.findUnique.mockResolvedValue(fila('DIGITADOR', 'Digitadores', 'CPE', 3));
    prisma.cargoCda.findFirst.mockResolvedValue(fila('SUPERVISOR', 'Supervisores', 'CPE', 8));
    await expect(service.renombrar('DIGITADOR', { nombre: 'supervisores' })).rejects.toThrow(ConflictException);
  });

  it('renombrar un protegido sí se puede (solo el nombre visible)', async () => {
    prisma.cargoCda.findUnique.mockResolvedValue(fila('OPERADOR', 'Operadores CDA', 'CDA', 1));
    prisma.cargoCda.update.mockResolvedValue(fila('OPERADOR', 'Operadores de CDA', 'CDA', 1));
    await expect(service.renombrar('OPERADOR', { nombre: 'Operadores de CDA' })).resolves.toBeDefined();
  });

  it('desactivar: operadores y asistentes CDA no se desactivan (app, parejas, kits)', async () => {
    for (const clave of ['OPERADOR', 'ASISTENTE']) {
      prisma.cargoCda.findUnique.mockResolvedValue(fila(clave, 'x', 'CDA', 1));
      await expect(service.cambiarActivo(clave, false)).rejects.toThrow(BadRequestException);
    }
    expect(prisma.cargoCda.update).not.toHaveBeenCalled();
  });

  it('desactivar y reactivar un cargo: no toca al personal, solo el estado', async () => {
    prisma.cargoCda.findUnique.mockResolvedValue(fila('DIGITADOR', 'Digitadores', 'CPE', 3));
    prisma.cargoCda.update.mockResolvedValue(fila('DIGITADOR', 'Digitadores', 'CPE', 3, false));
    await service.cambiarActivo('DIGITADOR', false);
    expect(prisma.cargoCda.update).toHaveBeenCalledWith({ where: { clave: 'DIGITADOR' }, data: { activo: false } });
    expect(Object.keys(prisma)).not.toContain('$executeRaw');

    prisma.cargoCda.findUnique.mockResolvedValue(null);
    await expect(service.cambiarActivo('NO_EXISTE', true)).rejects.toThrow(NotFoundException);
  });

  it('se refresca solo cada minuto (otro proceso o un arranque sin base se ponen al día)', async () => {
    jest.useFakeTimers();
    try {
      prisma.cargoCda.findMany.mockRejectedValueOnce(new Error('base despertando'));
      await service.onModuleInit();
      expect(() => parsearGrupo('JEFES')).toThrow(BadRequestException);
      prisma.cargoCda.findMany.mockResolvedValue([...TABLA, fila('JEFES', 'Jefes', 'CPE', 4)]);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(parsearGrupo('JEFES')).toBe('JEFES');
    } finally {
      service.onModuleDestroy();
      jest.useRealTimers();
    }
  });

  it('si el refresco falla después de guardar, igual responde y el registro queda con el cambio', async () => {
    prisma.cargoCda.findUnique.mockResolvedValue(fila('DIGITADOR', 'Digitadores', 'CPE', 3));
    prisma.cargoCda.update.mockResolvedValue(fila('DIGITADOR', 'Digitadores', 'CPE', 3, false));
    prisma.cargoCda.findMany.mockRejectedValue(new Error('se cortó'));
    await expect(service.cambiarActivo('DIGITADOR', false)).resolves.toMatchObject({ activo: false });
    expect(cargoActivo('DIGITADOR')).toBe(false);

    prisma.cargoCda.create.mockImplementation(({ data }) => Promise.resolve({ ...data, activo: true }));
    prisma.cargoCda.findMany.mockResolvedValueOnce(TABLA).mockRejectedValue(new Error('se cortó'));
    const r = await service.crear({ nombre: 'Jefes de turno', centro: 'CPE' });
    expect(parsearGrupo(r.clave)).toBe('JEFES_DE_TURNO');
  });

  it('una lectura vacía no borra el registro (la tabla nunca queda vacía)', async () => {
    prisma.cargoCda.findMany.mockResolvedValue([]);
    await service.onModuleInit();
    expect(parsearGrupo('OPERADOR')).toBe('OPERADOR');
  });

  it('al arrancar carga el registro; si la base falla no tumba la API (quedan los 9 originales)', async () => {
    prisma.cargoCda.findMany.mockResolvedValue([...TABLA, fila('JEFES', 'Jefes', 'CPE', 4)]);
    await service.onModuleInit();
    expect(parsearGrupo('JEFES')).toBe('JEFES');

    prisma.cargoCda.findMany.mockRejectedValue(new Error('sin base'));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});
