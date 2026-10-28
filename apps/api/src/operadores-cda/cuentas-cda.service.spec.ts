import { Test } from '@nestjs/testing';

jest.mock('argon2', () => ({ hash: jest.fn().mockResolvedValue('hash-inicial') }));
import * as argon2 from 'argon2';

import { CuentasCdaService } from './cuentas-cda.service';
import { PrismaService } from '../db/prisma.service';

const ROL_ID = 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr';
const OP_ID = 'oooooooo-oooo-oooo-oooo-oooooooooooo';
const USR_ID = 'uuuuuuuu-uuuu-uuuu-uuuu-uuuuuuuuuuuu';

function operador(overrides: Record<string, unknown> = {}) {
  return {
    id: OP_ID,
    cedula: '1710034065',
    apellidosNombres: 'PÉREZ LÓPEZ ANA MARÍA',
    telefono: '0987923273',
    grupo: 'ASISTENTE',
    activo: true,
    usuarioId: null,
    ...overrides,
  };
}

describe('CuentasCdaService', () => {
  let service: CuentasCdaService;

  const prisma = {
    operadorCda: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
    usuario: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    usuarioRol: { upsert: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
    rol: { findUnique: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.DEFAULT_RESET_PASSWORD;
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : Promise.all(arg as unknown[]),
    );
    prisma.rol.findUnique.mockResolvedValue({ id: ROL_ID });
    prisma.usuario.create.mockResolvedValue({ id: USR_ID });
    const moduleRef = await Test.createTestingModule({
      providers: [CuentasCdaService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CuentasCdaService);
  });

  describe('asegurarCuenta', () => {
    it('sin cuenta previa: crea la cuenta sin correo, con contraseña inicial y cambio obligatorio', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(operador());
      prisma.usuario.findUnique.mockResolvedValueOnce(null);

      const r = await service.asegurarCuenta(prisma as never, OP_ID);

      expect(r).toBe('CREADA');
      expect(argon2.hash).toHaveBeenCalledWith('Cne2026!');
      expect(prisma.usuario.create).toHaveBeenCalledWith({
        data: {
          cedula: '1710034065',
          email: null,
          apellidos: 'PÉREZ LÓPEZ',
          nombres: 'ANA MARÍA',
          telefono: '0987923273',
          passwordHash: 'hash-inicial',
          debeCambiarPwd: true,
          roles: { create: { rolId: ROL_ID } },
        },
        select: { id: true },
      });
      expect(prisma.operadorCda.update).toHaveBeenCalledWith({ where: { id: OP_ID }, data: { usuarioId: USR_ID } });
    });

    it('usa DEFAULT_RESET_PASSWORD si está configurada', async () => {
      process.env.DEFAULT_RESET_PASSWORD = 'OtraClave1!';
      prisma.operadorCda.findUnique.mockResolvedValueOnce(operador());
      prisma.usuario.findUnique.mockResolvedValueOnce(null);

      await service.asegurarCuenta(prisma as never, OP_ID);

      expect(argon2.hash).toHaveBeenCalledWith('OtraClave1!');
    });

    it('cuenta vieja con la misma cédula: la vincula, agrega el rol y NO toca la contraseña', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(operador());
      prisma.usuario.findUnique.mockResolvedValueOnce({ id: USR_ID, activo: true });

      const r = await service.asegurarCuenta(prisma as never, OP_ID);

      expect(r).toBe('VINCULADA');
      expect(prisma.usuario.create).not.toHaveBeenCalled();
      expect(argon2.hash).not.toHaveBeenCalled();
      for (const [args] of prisma.usuario.update.mock.calls) {
        expect(args.data).not.toHaveProperty('passwordHash');
        expect(args.data).not.toHaveProperty('debeCambiarPwd');
      }
      expect(prisma.usuarioRol.upsert).toHaveBeenCalledWith({
        where: { usuarioId_rolId: { usuarioId: USR_ID, rolId: ROL_ID } },
        create: { usuarioId: USR_ID, rolId: ROL_ID },
        update: {},
      });
      expect(prisma.operadorCda.update).toHaveBeenCalledWith({ where: { id: OP_ID }, data: { usuarioId: USR_ID } });
    });

    it('cuenta vieja inactiva: la reactiva al vincular', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(operador());
      prisma.usuario.findUnique.mockResolvedValueOnce({ id: USR_ID, activo: false });

      await service.asegurarCuenta(prisma as never, OP_ID);

      expect(prisma.usuario.update).toHaveBeenCalledWith({ where: { id: USR_ID }, data: { activo: true } });
    });

    it('ya vinculada: reactiva y garantiza el rol, sin crear nada', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(operador({ usuarioId: USR_ID }));

      const r = await service.asegurarCuenta(prisma as never, OP_ID);

      expect(r).toBe('YA_TENIA');
      expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
      expect(prisma.usuario.create).not.toHaveBeenCalled();
      expect(prisma.usuario.update).toHaveBeenCalledWith({ where: { id: USR_ID }, data: { activo: true } });
      expect(prisma.usuarioRol.upsert).toHaveBeenCalled();
    });

    it.each([
      ['otro cargo (DIGITADOR)', { grupo: 'DIGITADOR' }],
      ['persona inactiva', { activo: false }],
    ])('no aplica a %s', async (_caso, cambios) => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(operador(cambios));

      const r = await service.asegurarCuenta(prisma as never, OP_ID);

      expect(r).toBe('NO_APLICA');
      expect(prisma.usuario.create).not.toHaveBeenCalled();
      expect(prisma.usuarioRol.upsert).not.toHaveBeenCalled();
    });
  });

  describe('retirarCuenta', () => {
    it('quita el rol, desactiva si era su único rol y cierra sus sesiones', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(operador({ usuarioId: USR_ID }));
      prisma.usuarioRol.count.mockResolvedValueOnce(0);

      await service.retirarCuenta(prisma as never, OP_ID);

      expect(prisma.usuarioRol.deleteMany).toHaveBeenCalledWith({ where: { usuarioId: USR_ID, rolId: ROL_ID } });
      expect(prisma.usuario.update).toHaveBeenCalledWith({ where: { id: USR_ID }, data: { activo: false } });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: USR_ID, revocadoEn: null },
        data: { revocadoEn: expect.any(Date) },
      });
    });

    it('si tiene otros roles (p. ej. Administrador) NO desactiva la cuenta', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(operador({ usuarioId: USR_ID }));
      prisma.usuarioRol.count.mockResolvedValueOnce(1);

      await service.retirarCuenta(prisma as never, OP_ID);

      expect(prisma.usuarioRol.deleteMany).toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    });

    it('sin cuenta vinculada no hace nada', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(operador({ usuarioId: null }));

      await service.retirarCuenta(prisma as never, OP_ID);

      expect(prisma.usuarioRol.deleteMany).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('sincronizar', () => {
    it('procesa a cada operador/asistente activo sin cuenta y cuenta vinculadas y creadas', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
      prisma.operadorCda.findUnique
        .mockResolvedValueOnce(operador({ id: 'a' }))
        .mockResolvedValueOnce(operador({ id: 'b', cedula: '1002003000' }));
      prisma.usuario.findUnique.mockResolvedValueOnce({ id: 'viejo', activo: true }).mockResolvedValueOnce(null);

      const r = await service.sincronizar();

      expect(prisma.operadorCda.findMany).toHaveBeenCalledWith({
        where: { grupo: { in: ['OPERADOR', 'ASISTENTE'] }, activo: true, usuarioId: null },
        select: { id: true },
        orderBy: { apellidosNombres: 'asc' },
      });
      expect(r).toEqual({ vinculadas: 1, creadas: 1 });
    });

    it('puede limitarse a ciertos ids o cédulas (alta manual e importación)', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([]);

      await service.sincronizar({ ids: ['a'] });
      await service.sincronizar({ cedulas: ['1710034065'] });

      expect(prisma.operadorCda.findMany.mock.calls[0][0].where).toMatchObject({ id: { in: ['a'] } });
      expect(prisma.operadorCda.findMany.mock.calls[1][0].where).toMatchObject({ cedula: { in: ['1710034065'] } });
    });

    it('si otra pulsación simultánea ya creó la cuenta (P2002), reintenta y la vincula', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([{ id: 'a' }]);
      prisma.operadorCda.findUnique.mockResolvedValue(operador({ id: 'a' }));
      prisma.usuario.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: USR_ID, activo: true });
      prisma.usuario.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));

      const r = await service.sincronizar();

      expect(r).toEqual({ vinculadas: 1, creadas: 0 });
    });
  });

  describe('resumen', () => {
    it('devuelve los conteos de cuentas', async () => {
      prisma.operadorCda.count
        .mockResolvedValueOnce(70) // conCuenta
        .mockResolvedValueOnce(51) // sinCuenta
        .mockResolvedValueOnce(40) // pendientesCambioPwd
        .mockResolvedValueOnce(2); // bloqueadas
      prisma.usuario.count.mockResolvedValueOnce(10);

      await expect(service.resumen()).resolves.toEqual({
        conCuenta: 70,
        sinCuenta: 51,
        pendientesCambioPwd: 40,
        bloqueadas: 2,
        cuentasSinVinculo: 10,
      });
    });
  });

  describe('desactivarSinVinculo', () => {
    it('desactiva solo cuentas activas cuyo único rol es Operador CDA y sin persona vinculada', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([{ id: 'x' }, { id: 'y' }]);
      prisma.usuario.updateMany.mockResolvedValueOnce({ count: 2 });

      const r = await service.desactivarSinVinculo();

      expect(prisma.usuario.findMany).toHaveBeenCalledWith({
        where: {
          activo: true,
          operadorCda: { is: null },
          roles: { some: { rol: { nombre: 'OPERADOR_CDA' } }, every: { rol: { nombre: 'OPERADOR_CDA' } } },
        },
        select: { id: true },
      });
      expect(prisma.usuario.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['x', 'y'] } }, data: { activo: false } });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: { in: ['x', 'y'] }, revocadoEn: null },
        data: { revocadoEn: expect.any(Date) },
      });
      expect(r).toEqual({ desactivadas: 2 });
    });

    it('sin cuentas que desactivar no escribe nada', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([]);

      await expect(service.desactivarSinVinculo()).resolves.toEqual({ desactivadas: 0 });
      expect(prisma.usuario.updateMany).not.toHaveBeenCalled();
    });
  });
});
