import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { agregarPersonaDistribucionSchema, crearDistribucionDiasSchema } from '@cne/shared-validation';

import type { PrismaService } from '../db/prisma.service';
import type { DistributivoTecnicosClient } from '../enlaces/distributivo-tecnicos.client';
import { DistribucionDiasService } from './distribucion-dias.service';

const ID = '33333333-3333-4333-8333-333333333333';
const OP_CDA = '22222222-2222-4222-8222-222222222222';
const OP_CPE = '44444444-4444-4444-8444-444444444444';
const FILA = '55555555-5555-4555-8555-555555555555';
const DIAS = ['2026-11-20', '2026-11-21', '2026-11-22'];
const fecha = (s: string) => new Date(`${s}T00:00:00Z`);

const BASE = { id: ID, fechas: DIAS.map(fecha), excluirCargos: ['SUPERVISOR', 'ASISTENTE_ARCHIVOS'], cantonCpe: 'IBARRA', encargadoCpe: 'Edison Mafla' };

function filaRegistrada(over: Record<string, unknown> = {}) {
  return {
    id: FILA,
    fecha: fecha(DIAS[0]),
    operadorId: OP_CDA,
    cedula: '1712345678',
    nombres: null,
    telefono: null,
    sexo: null,
    cargo: null,
    canton: 'OTAVALO',
    encargado: 'Willy',
    operador: { apellidosNombres: 'PÉREZ JUAN', cedula: '1712345678', telefono: '0991234567', sexo: 'M', cargoCda: { nombre: 'Operadores CDA' } },
    ...over,
  };
}

describe('DistribucionDiasService', () => {
  const prisma = {
    distribucionDias: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    distribucionDiasPersona: { findFirst: jest.fn(), create: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
    operadorCda: { findMany: jest.fn(), findFirst: jest.fn() },
    cargoCda: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const distributivo = { asignaciones: jest.fn() };
  let service: DistribucionDiasService;

  beforeEach(() => {
    jest.clearAllMocks();
    // base() y detalle() usan findUnique: base primero, luego el detalle completo.
    prisma.distribucionDias.findUnique.mockImplementation(({ select }: { select: Record<string, unknown> }) =>
      Promise.resolve(select.personas ? { ...BASE, nombre: 'Fin de semana', creadoEn: new Date('2026-11-18T12:00:00Z'), personas: [] } : BASE),
    );
    // Transacción interactiva: el callback recibe el mismo cliente simulado.
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.cargoCda.findMany.mockImplementation(({ where }: { where: { clave: { in: string[] } } }) => Promise.resolve(where.clave.in.map((clave) => ({ clave }))));
    prisma.$queryRaw.mockResolvedValue([{ operadorId: OP_CDA, canton: 'OTAVALO', codigo: 'R-1' }]);
    distributivo.asignaciones.mockResolvedValue([{ codigoRecinto: 'R-1', localidad: '', parroquia: '', numeroTecnico: 1, tecnico: 'Willy' }]);
    service = new DistribucionDiasService(prisma as unknown as PrismaService, distributivo as unknown as DistributivoTecnicosClient);
  });

  describe('regenerar', () => {
    it('reparte al personal activo menos los cargos excluidos; CDA con cantón y técnico de su último recinto, CPE con los de la distribución', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([
        { id: OP_CDA, cedula: '1712345678', sexo: 'M', cargoCda: { centro: 'CDA' } },
        { id: OP_CPE, cedula: '1003456785', sexo: 'F', cargoCda: { centro: 'CPE' } },
      ]);
      const r = await service.regenerar(ID);
      expect(prisma.operadorCda.findMany.mock.calls[0][0].where).toEqual({ activo: true, grupo: { notIn: ['SUPERVISOR', 'ASISTENTE_ARCHIVOS'] } });
      const data = prisma.distribucionDiasPersona.createMany.mock.calls[0][0].data;
      expect(data).toEqual([
        { distribucionId: ID, fecha: fecha(DIAS[0]), operadorId: OP_CDA, cedula: '1712345678', canton: 'OTAVALO', encargado: 'Willy' },
        { distribucionId: ID, fecha: fecha(DIAS[1]), operadorId: OP_CPE, cedula: '1003456785', canton: 'IBARRA', encargado: 'Edison Mafla' },
      ]);
      // Borra lo anterior en la misma transacción.
      expect(prisma.distribucionDiasPersona.deleteMany).toHaveBeenCalledWith({ where: { distribucionId: ID } });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Toma el candado de la distribución antes de borrar y volver a crear.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.distribucionDiasPersona.deleteMany.mock.invocationCallOrder[0]);
      expect(r.avisos).toEqual([]);
    });

    it('si el Drive falla se arma igual, con el encargado del CDA vacío y un aviso', async () => {
      distributivo.asignaciones.mockRejectedValue(new Error('timeout'));
      prisma.operadorCda.findMany.mockResolvedValue([{ id: OP_CDA, cedula: '1712345678', sexo: 'M', cargoCda: { centro: 'CDA' } }]);
      const r = await service.regenerar(ID);
      expect(prisma.distribucionDiasPersona.createMany.mock.calls[0][0].data[0]).toMatchObject({ canton: 'OTAVALO', encargado: null });
      expect(r.avisos).toHaveLength(1);
    });

    it('sin cargos excluidos no filtra por grupo; quien no tiene pareja queda sin cantón', async () => {
      prisma.distribucionDias.findUnique.mockImplementation(({ select }: { select: Record<string, unknown> }) =>
        Promise.resolve(select.personas ? { ...BASE, excluirCargos: [], nombre: 'x', creadoEn: new Date(), personas: [] } : { ...BASE, excluirCargos: [] }),
      );
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.operadorCda.findMany.mockResolvedValue([{ id: OP_CDA, cedula: '1712345678', sexo: 'F', cargoCda: { centro: 'CDA' } }]);
      await service.regenerar(ID);
      expect(prisma.operadorCda.findMany.mock.calls[0][0].where).toEqual({ activo: true });
      expect(prisma.distribucionDiasPersona.createMany.mock.calls[0][0].data[0]).toMatchObject({ canton: null, encargado: null });
    });

    it('404 si la distribución no existe', async () => {
      prisma.distribucionDias.findUnique.mockResolvedValue(null);
      await expect(service.regenerar(ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('crear guarda los datos (vacíos como null) y reparte', async () => {
    prisma.distribucionDias.create.mockResolvedValue({ id: ID });
    prisma.operadorCda.findMany.mockResolvedValue([]);
    const body = crearDistribucionDiasSchema.parse({ nombre: 'Fin de semana', fechas: [DIAS[2], DIAS[0]], excluirCargos: ['SUPERVISOR'], cantonCpe: '', encargadoCpe: 'Edison Mafla' });
    await service.crear(body, 'u1');
    expect(prisma.distribucionDias.create.mock.calls[0][0].data).toEqual({
      nombre: 'Fin de semana',
      fechas: [fecha(DIAS[0]), fecha(DIAS[2])],
      excluirCargos: ['SUPERVISOR'],
      cantonCpe: null,
      encargadoCpe: 'Edison Mafla',
      creadoPorId: 'u1',
    });
    expect(prisma.distribucionDiasPersona.createMany).toHaveBeenCalled();
  });

  it('crear: 400 si un cargo excluido no existe (no crea nada)', async () => {
    prisma.cargoCda.findMany.mockResolvedValue([{ clave: 'SUPERVISOR' }]);
    const body = crearDistribucionDiasSchema.parse({ nombre: 'Fin de semana', fechas: [DIAS[0]], excluirCargos: ['SUPERVISOR', 'NO_EXISTE'] });
    await expect(service.crear(body, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.distribucionDias.create).not.toHaveBeenCalled();
  });

  it('crear: si el reparto falla, borra la distribución recién creada', async () => {
    prisma.distribucionDias.create.mockResolvedValue({ id: ID });
    prisma.distribucionDias.delete.mockResolvedValue({ id: ID });
    prisma.operadorCda.findMany.mockRejectedValue(new Error('base caída'));
    const body = crearDistribucionDiasSchema.parse({ nombre: 'Fin de semana', fechas: [DIAS[0]], excluirCargos: [] });
    await expect(service.crear(body, 'u1')).rejects.toThrow('base caída');
    expect(prisma.distribucionDias.delete).toHaveBeenCalledWith({ where: { id: ID } });
  });

  it('regenerar sin personal activo deja la distribución vacía', async () => {
    prisma.operadorCda.findMany.mockResolvedValue([]);
    const r = await service.regenerar(ID);
    expect(prisma.distribucionDiasPersona.createMany).toHaveBeenCalledWith({ data: [] });
    expect(r.total).toBe(0);
  });

  describe('detalle', () => {
    it('del personal registrado toma nombre, celular, sexo y cargo de la ficha; de un externo, de la fila', async () => {
      prisma.distribucionDias.findUnique.mockResolvedValue({
        ...BASE,
        nombre: 'Fin de semana',
        creadoEn: new Date('2026-11-18T12:00:00Z'),
        personas: [
          filaRegistrada(),
          filaRegistrada({
            id: 'e',
            fecha: fecha(DIAS[1]),
            operadorId: null,
            operador: null,
            cedula: '1003456785',
            nombres: 'RUIZ ANA',
            telefono: '0987654321',
            sexo: 'F',
            cargo: 'Apoyo logístico',
            canton: null,
            encargado: null,
          }),
        ],
      });
      const d = await service.detalle(ID);
      expect(d.personas).toEqual([
        { id: FILA, fecha: DIAS[0], operadorId: OP_CDA, nombres: 'PÉREZ JUAN', cedula: '1712345678', telefono: '0991234567', sexo: 'M', cargo: 'Operadores CDA', canton: 'OTAVALO', encargado: 'Willy' },
        { id: 'e', fecha: DIAS[1], operadorId: null, nombres: 'RUIZ ANA', cedula: '1003456785', telefono: '0987654321', sexo: 'F', cargo: 'Apoyo logístico', canton: null, encargado: null },
      ]);
      expect(d.totales.map((t) => t.total)).toEqual([1, 1, 0]);
      expect(d.fechas).toEqual(DIAS);
    });
  });

  describe('agregar', () => {
    it('persona registrada de cualquier cargo: toma cédula, cantón y encargado', async () => {
      prisma.operadorCda.findFirst.mockResolvedValue({ id: OP_CDA, cedula: '1712345678', cargoCda: { centro: 'CDA' } });
      prisma.distribucionDiasPersona.create.mockResolvedValue(filaRegistrada());
      const body = agregarPersonaDistribucionSchema.parse({ tipo: 'REGISTRADA', fecha: DIAS[0], operadorId: OP_CDA });
      await service.agregar(ID, body);
      expect(prisma.operadorCda.findFirst.mock.calls[0][0].where).toEqual({ id: OP_CDA, activo: true });
      expect(prisma.distribucionDiasPersona.create.mock.calls[0][0].data).toEqual({
        distribucionId: ID,
        fecha: fecha(DIAS[0]),
        operadorId: OP_CDA,
        cedula: '1712345678',
        canton: 'OTAVALO',
        encargado: 'Willy',
      });
    });

    it('persona externa: guarda sus datos en la fila', async () => {
      prisma.distribucionDiasPersona.create.mockResolvedValue(filaRegistrada({ operadorId: null, operador: null, nombres: 'RUIZ ANA', sexo: 'F', cargo: 'Apoyo' }));
      const body = agregarPersonaDistribucionSchema.parse({
        tipo: 'EXTERNA',
        fecha: DIAS[1],
        nombres: '  RUIZ   ANA ',
        cedula: '1003456785',
        telefono: '099-123-4567',
        sexo: 'F',
        cargo: 'Apoyo',
        canton: '',
        encargado: 'Willy',
      });
      await service.agregar(ID, body);
      expect(prisma.distribucionDiasPersona.create.mock.calls[0][0].data).toEqual({
        distribucionId: ID,
        fecha: fecha(DIAS[1]),
        cedula: '1003456785',
        nombres: 'RUIZ ANA',
        telefono: '0991234567',
        sexo: 'F',
        cargo: 'Apoyo',
        canton: null,
        encargado: 'Willy',
      });
      expect(prisma.operadorCda.findFirst).not.toHaveBeenCalled();
    });

    it('409 si la cédula ya está en la distribución', async () => {
      prisma.operadorCda.findFirst.mockResolvedValue({ id: OP_CPE, cedula: '1003456785', cargoCda: { centro: 'CPE' } });
      prisma.distribucionDiasPersona.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
      await expect(service.agregar(ID, { tipo: 'REGISTRADA', fecha: DIAS[0], operadorId: OP_CPE })).rejects.toBeInstanceOf(ConflictException);
    });

    it('400 si el día no es de la distribución; 404 si la persona no está activa', async () => {
      await expect(service.agregar(ID, { tipo: 'REGISTRADA', fecha: '2026-11-23', operadorId: OP_CDA })).rejects.toBeInstanceOf(BadRequestException);
      prisma.operadorCda.findFirst.mockResolvedValue(null);
      await expect(service.agregar(ID, { tipo: 'REGISTRADA', fecha: DIAS[0], operadorId: OP_CDA })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('editar y quitar', () => {
    it('cambia el día y deja el cantón vacío como null', async () => {
      prisma.distribucionDiasPersona.findFirst.mockResolvedValue({ id: FILA });
      prisma.distribucionDiasPersona.update.mockResolvedValue(filaRegistrada());
      await service.editar(ID, FILA, { fecha: DIAS[2], canton: '' });
      expect(prisma.distribucionDiasPersona.findFirst).toHaveBeenCalledWith({ where: { id: FILA, distribucionId: ID }, select: { id: true } });
      expect(prisma.distribucionDiasPersona.update.mock.calls[0][0].data).toEqual({ fecha: fecha(DIAS[2]), canton: null });
    });

    it('no edita ni quita una fila de otra distribución', async () => {
      prisma.distribucionDiasPersona.findFirst.mockResolvedValue(null);
      await expect(service.editar(ID, FILA, { encargado: 'Willy' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.quitar(ID, FILA)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.distribucionDiasPersona.update).not.toHaveBeenCalled();
      expect(prisma.distribucionDiasPersona.delete).not.toHaveBeenCalled();
    });

    it('400 al mover a un día que no es de la distribución', async () => {
      await expect(service.editar(ID, FILA, { fecha: '2026-11-23' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('candidatos', () => {
    it('personal activo de cualquier cargo que no está en la distribución, hasta 20', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([{ id: OP_CPE, apellidosNombres: 'RUIZ ANA', cedula: '1003456785', cargoCda: { nombre: 'Supervisores' } }]);
      const r = await service.candidatos(ID, '');
      expect(r).toEqual([{ id: OP_CPE, nombre: 'RUIZ ANA', cedula: '1003456785', cargo: 'Supervisores' }]);
      const arg = prisma.operadorCda.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ activo: true, distribucionesDias: { none: { distribucionId: ID } } });
      expect(arg.take).toBe(20);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('con texto busca por nombre o cédula en SQL', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: OP_CPE }]);
      prisma.operadorCda.findMany.mockResolvedValue([]);
      await service.candidatos(ID, 'ruiz');
      expect(prisma.operadorCda.findMany.mock.calls[0][0].where.id).toEqual({ in: [OP_CPE] });
    });
  });

  it('reporte: 400 si se pide un día ajeno; arma el Excel', async () => {
    await expect(service.reporte(ID, { fecha: '2026-11-23' }, 'xlsx')).rejects.toBeInstanceOf(BadRequestException);
    const r = await service.reporte(ID, {}, 'xlsx');
    expect(r.nombre).toBe('distribucion_personal_2026-11-20_2026-11-22.xlsx');
    expect(r.contenido.length).toBeGreaterThan(0);
  });
});
