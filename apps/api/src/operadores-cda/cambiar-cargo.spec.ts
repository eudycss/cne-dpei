import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { OperadoresCdaService } from './operadores-cda.service';
import { PrismaService } from '../db/prisma.service';
import { CuentasCdaService } from './cuentas-cda.service';

const OP = '11111111-2222-4333-8444-555555555555';
const USR = '99999999-2222-4333-8444-555555555555';

const FILA = {
  id: OP,
  grupo: 'OPERADOR',
  numero: 1,
  apellidosNombres: 'RUIZ MORA JUAN',
  cedula: '1710034065',
  telefono: null,
  cargo: 'OPERADOR CDA',
  unidad: null,
  fechaInicio: null,
  fotoKey: null,
  activo: true,
  creadoEn: new Date('2026-10-20T10:00:00Z'),
};

describe('OperadoresCdaService.cambiarCargo', () => {
  let service: OperadoresCdaService;
  const tx = {
    operadorCda: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    cambioCargoCda: { create: jest.fn() },
  };
  const prisma = {
    operadorCda: { findUnique: jest.fn() },
    asistenciaCda: { findFirst: jest.fn() },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const cuentas = {
    tieneCuenta: jest.fn((g: string) => g === 'OPERADOR' || g === 'ASISTENTE'),
    asegurarCuenta: jest.fn(),
    retirarCuenta: jest.fn(),
  };
  const leido = (over: Record<string, unknown> = {}) => ({
    grupo: 'ASISTENTE',
    activo: true,
    _count: { credenciales: 0, actas: 0 },
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // 25-oct-2026 21:00 en Ecuador = 26-oct 02:00 UTC: el cambio rige el 25 (hora de Ecuador).
    jest.useFakeTimers({ now: new Date('2026-10-26T02:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    tx.operadorCda.updateMany.mockResolvedValue({ count: 1 });
    prisma.asistenciaCda.findFirst.mockResolvedValue(null);
    tx.operadorCda.findUniqueOrThrow.mockResolvedValue(FILA);
    const moduleRef = await Test.createTestingModule({
      providers: [
        OperadoresCdaService,
        { provide: PrismaService, useValue: prisma },
        { provide: CuentasCdaService, useValue: cuentas },
      ],
    }).compile();
    service = moduleRef.get(OperadoresCdaService);
  });

  afterEach(() => jest.useRealTimers());

  it('cambia el cargo desde hoy (Ecuador) y registra el cambio con quién lo hizo', async () => {
    prisma.operadorCda.findUnique.mockResolvedValueOnce(leido());
    const r = await service.cambiarCargo(OP, 'OPERADOR', USR);

    expect(tx.operadorCda.updateMany).toHaveBeenCalledWith({ where: { id: OP, grupo: 'ASISTENTE' }, data: { grupo: 'OPERADOR' } });
    expect(tx.cambioCargoCda.create).toHaveBeenCalledWith({
      data: {
        operadorId: OP,
        grupoAnterior: 'ASISTENTE',
        grupoNuevo: 'OPERADOR',
        desde: new Date('2026-10-25T00:00:00Z'),
        hechoPorId: USR,
      },
    });
    expect(r).toMatchObject({
      grupoAnterior: 'ASISTENTE',
      desde: '2026-10-25',
      carnetVigente: false,
      actaVigente: false,
      operador: { grupo: 'OPERADOR' },
    });
  });

  it('si hoy ya marcó entrada, rige desde mañana: esa marca queda en el cargo anterior', async () => {
    prisma.operadorCda.findUnique.mockResolvedValueOnce(leido());
    prisma.asistenciaCda.findFirst.mockResolvedValueOnce({ id: 'a1' });
    const r = await service.cambiarCargo(OP, 'OPERADOR', USR);
    expect(prisma.asistenciaCda.findFirst.mock.calls[0][0].where).toEqual({
      operadorId: OP,
      fecha: new Date('2026-10-25T00:00:00Z'),
      entradaEn: { not: null },
    });
    expect(tx.cambioCargoCda.create.mock.calls[0][0].data.desde).toEqual(new Date('2026-10-26T00:00:00Z'));
    expect(r.desde).toBe('2026-10-26');
  });

  it('informa si tiene carnet sin anular y acta (dicen el cargo anterior)', async () => {
    prisma.operadorCda.findUnique.mockResolvedValueOnce(leido({ _count: { credenciales: 1, actas: 2 } }));
    const r = await service.cambiarCargo(OP, 'OPERADOR', USR);
    expect(r).toMatchObject({ carnetVigente: true, actaVigente: true });
    // Solo cuentan los carnets sin anular.
    expect(prisma.operadorCda.findUnique.mock.calls[0][0].select._count.select.credenciales).toEqual({ where: { revocadaEn: null } });
  });

  it('al mismo cargo: 400 y no toca nada', async () => {
    prisma.operadorCda.findUnique.mockResolvedValueOnce(leido({ grupo: 'OPERADOR' }));
    await expect(service.cambiarCargo(OP, 'OPERADOR', USR)).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('no existe: 404; oculto: 409', async () => {
    prisma.operadorCda.findUnique.mockResolvedValueOnce(null);
    await expect(service.cambiarCargo(OP, 'OPERADOR', USR)).rejects.toThrow(NotFoundException);
    prisma.operadorCda.findUnique.mockResolvedValueOnce(leido({ activo: false }));
    await expect(service.cambiarCargo(OP, 'OPERADOR', USR)).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('si otro administrador lo cambió entretanto: 409 y no registra el cambio', async () => {
    prisma.operadorCda.findUnique.mockResolvedValueOnce(leido());
    tx.operadorCda.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.cambiarCargo(OP, 'OPERADOR', USR)).rejects.toThrow(ConflictException);
    expect(tx.cambioCargoCda.create).not.toHaveBeenCalled();
  });

  describe('cuenta de la app', () => {
    it('de asistente a digitador: retira la cuenta en la misma transacción', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(leido({ grupo: 'ASISTENTE' }));
      await service.cambiarCargo(OP, 'DIGITADOR', USR);
      expect(cuentas.retirarCuenta).toHaveBeenCalledWith(tx, OP);
      expect(cuentas.asegurarCuenta).not.toHaveBeenCalled();
    });

    it('de digitador a operador: asegura la cuenta', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(leido({ grupo: 'DIGITADOR' }));
      await service.cambiarCargo(OP, 'OPERADOR', USR);
      expect(cuentas.asegurarCuenta).toHaveBeenCalledWith(tx, OP);
      expect(cuentas.retirarCuenta).not.toHaveBeenCalled();
    });

    it('entre operador y asistente la cuenta no cambia', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(leido({ grupo: 'ASISTENTE' }));
      await service.cambiarCargo(OP, 'OPERADOR', USR);
      expect(cuentas.asegurarCuenta).not.toHaveBeenCalled();
      expect(cuentas.retirarCuenta).not.toHaveBeenCalled();
    });
  });
});
