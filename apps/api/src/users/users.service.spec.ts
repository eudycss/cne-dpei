import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { UsersService } from './users.service';
import { PrismaService } from '../db/prisma.service';
import { NOTIFIER } from '../auth/notifier';

describe('UsersService', () => {
  let service: UsersService;

  const prisma = {
    usuario: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn(),
    },
    rol: {
      findMany: jest.fn(),
    },
    usuarioRol: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn((arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
    ),
  };

  const notifier = {
    sendInitialPassword: jest.fn().mockResolvedValue(undefined),
  };

  const validInput = {
    cedula: '1002003004',
    email: 'nuevo@cne-imbabura.gob.ec',
    nombres: 'Ana',
    apellidos: 'López',
  };

  function userRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      cedula: validInput.cedula,
      email: validInput.email,
      nombres: validInput.nombres,
      apellidos: validInput.apellidos,
      telefono: null,
      activo: true,
      debeCambiarPwd: true,
      roles: [{ rol: { nombre: 'OPERADOR_CDA' } }],
      creadoEn: new Date('2026-06-19T10:00:00Z'),
      actualizadoEn: new Date('2026-06-19T10:00:00Z'),
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: NOTIFIER, useValue: notifier },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe('create', () => {
    it('crea el usuario, envía la contraseña inicial y la devuelve', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null); // email y cédula libres
      prisma.usuario.create.mockResolvedValue(userRow());

      const result = await service.create(validInput as any);

      expect(result.email).toBe(validInput.email);
      expect(result.roles).toEqual(['OPERADOR_CDA']);
      expect(typeof result.initialPassword).toBe('string');
      expect(result.initialPassword.length).toBe(12);
      expect(notifier.sendInitialPassword).toHaveBeenCalledWith(
        validInput.email,
        result.initialPassword,
      );
    });

    it('lanza ConflictException si el email ya está registrado', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow()); // email ocupado

      await expect(service.create(validInput as any)).rejects.toThrow(ConflictException);
      expect(prisma.usuario.create).not.toHaveBeenCalled();
    });

    it('lanza ConflictException si la cédula ya está registrada', async () => {
      prisma.usuario.findUnique
        .mockResolvedValueOnce(null) // email libre
        .mockResolvedValueOnce(userRow()); // cédula ocupada

      await expect(service.create(validInput as any)).rejects.toThrow(ConflictException);
      expect(prisma.usuario.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    it('lanza NotFoundException si el usuario no existe', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(null);

      await expect(service.update(id, { nombres: 'X' } as any)).rejects.toThrow(NotFoundException);
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('valida unicidad del email al cambiarlo', async () => {
      const nuevoEmail = 'cambio@cne-imbabura.gob.ec';
      prisma.usuario.findUnique
        .mockResolvedValueOnce(userRow({ id })) // existing
        .mockResolvedValueOnce(userRow()); // email nuevo ya ocupado

      await expect(service.update(id, { email: nuevoEmail } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.usuario.findUnique).toHaveBeenLastCalledWith({ where: { email: nuevoEmail } });
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    it('lanza NotFoundException si el usuario no existe', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(null);

      await expect(service.resetPassword(id)).rejects.toThrow(NotFoundException);
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('fuerza cambio de contraseña, revoca sesiones y devuelve la temporal', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ id }));

      const { temporaryPassword } = await service.resetPassword(id);

      expect(typeof temporaryPassword).toBe('string');
      expect(temporaryPassword.length).toBeGreaterThan(0);
      expect(prisma.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id },
          data: expect.objectContaining({ debeCambiarPwd: true }),
        }),
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: id, revocadoEn: null },
        data: { revocadoEn: expect.any(Date) },
      });
    });
  });

  describe('assignRoles', () => {
    const userIds = ['dddddddd-dddd-dddd-dddd-dddddddddddd'];
    const roleIds = ['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'];

    it('lanza BadRequestException si algún rol no existe', async () => {
      prisma.rol.findMany.mockResolvedValueOnce([]); // ninguno de los roleIds existe

      await expect(service.assignRoles(userIds, roleIds)).rejects.toThrow(BadRequestException);
      expect(prisma.usuarioRol.createMany).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si algún usuario no existe', async () => {
      prisma.rol.findMany.mockResolvedValueOnce([{ id: roleIds[0] }]);
      prisma.usuario.findMany.mockResolvedValueOnce([]); // usuario no existe

      await expect(service.assignRoles(userIds, roleIds)).rejects.toThrow(BadRequestException);
      expect(prisma.usuarioRol.createMany).not.toHaveBeenCalled();
    });

    it('reemplaza los roles del usuario y devuelve el conteo', async () => {
      prisma.rol.findMany.mockResolvedValueOnce([{ id: roleIds[0] }]);
      prisma.usuario.findMany.mockResolvedValueOnce([{ id: userIds[0] }]);

      const result = await service.assignRoles(userIds, roleIds);

      expect(result).toEqual({ actualizados: 1 });
      expect(prisma.usuarioRol.deleteMany).toHaveBeenCalledWith({
        where: { usuarioId: { in: userIds } },
      });
      expect(prisma.usuarioRol.createMany).toHaveBeenCalled();
    });
  });

  describe('bulkUpload', () => {
    it('lanza BadRequestException si no se envía archivo', async () => {
      await expect(service.bulkUpload(undefined as any)).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el formato no es soportado', async () => {
      const file = {
        originalname: 'usuarios.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('cualquier cosa'),
      } as Express.Multer.File;

      await expect(service.bulkUpload(file)).rejects.toThrow(BadRequestException);
    });

    it('crea las filas válidas y reporta las inválidas (CSV)', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null); // email/cédula siempre libres
      prisma.usuario.create.mockResolvedValue(userRow());

      const csv = [
        'cedula,email,nombres,apellidos,telefono',
        '1002003004,uno@cne-imbabura.gob.ec,Ana,Lopez,',
        '12,malo@cne-imbabura.gob.ec,Bad,Row,', // cédula inválida -> error
      ].join('\n');
      const file = {
        originalname: 'usuarios.csv',
        mimetype: 'text/csv',
        buffer: Buffer.from(csv, 'utf8'),
      } as Express.Multer.File;

      const result = await service.bulkUpload(file);

      expect(result.creados).toBe(1);
      expect(result.errores).toHaveLength(1);
      expect(result.errores[0].fila).toBe(3);
      expect(prisma.usuario.create).toHaveBeenCalledTimes(1);
    });
  });
});
