import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ZodError } from 'zod';

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
    cedula: '1034567899', // cédula con dígito verificador válido (algoritmo módulo-10)
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

  describe('list', () => {
    it('trae hasta 500 por página (todos los operadores CDA para los combos de Kits)', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([]);
      prisma.usuario.count.mockResolvedValueOnce(0);

      const r = await service.list({ role: 'OPERADOR_CDA', activo: true, pageSize: 500 });

      expect(prisma.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
      expect(r.pageSize).toBe(500);
    });

    it('no pasa de 500 aunque se pidan más', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([]);
      prisma.usuario.count.mockResolvedValueOnce(0);

      await service.list({ pageSize: 10000 });

      expect(prisma.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
    });

    it('un pageSize que no es número usa el valor por defecto (no un 500)', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([]);
      prisma.usuario.count.mockResolvedValueOnce(0);

      await service.list({ pageSize: Number('abc') });

      expect(prisma.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
    });
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

    it('permite cambiar la cédula si está libre', async () => {
      const nuevaCedula = '1710034065';
      prisma.usuario.findUnique
        .mockResolvedValueOnce(userRow({ id })) // existing
        .mockResolvedValueOnce(null); // cédula nueva libre
      prisma.usuario.update.mockResolvedValue(userRow({ id, cedula: nuevaCedula }));

      const result = await service.update(id, { cedula: nuevaCedula } as any);

      expect(result.cedula).toBe(nuevaCedula);
      expect(prisma.usuario.findUnique).toHaveBeenLastCalledWith({ where: { cedula: nuevaCedula } });
      expect(prisma.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id }, data: expect.objectContaining({ cedula: nuevaCedula }) }),
      );
    });

    it('lanza ConflictException si la cédula nueva ya pertenece a otro usuario', async () => {
      const nuevaCedula = '1710034065';
      prisma.usuario.findUnique
        .mockResolvedValueOnce(userRow({ id })) // existing
        .mockResolvedValueOnce(userRow({ cedula: nuevaCedula })); // ocupada

      await expect(service.update(id, { cedula: nuevaCedula } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('responde 409 si otra edición ocupó la cédula entre el chequeo y el update (P2002)', async () => {
      prisma.usuario.findUnique
        .mockResolvedValueOnce(userRow({ id })) // existing
        .mockResolvedValueOnce(null); // parecía libre
      prisma.usuario.update.mockRejectedValueOnce({ code: 'P2002' });

      await expect(service.update(id, { cedula: '1710034065' } as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rechaza una cédula con dígito verificador inválido', async () => {
      await expect(service.update(id, { cedula: '1710034066' } as any)).rejects.toThrow(ZodError);
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('no consulta unicidad si la cédula no cambió', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ id }));
      prisma.usuario.update.mockResolvedValue(userRow({ id }));

      await service.update(id, { cedula: validInput.cedula } as any);

      expect(prisma.usuario.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.usuario.update).toHaveBeenCalled();
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

      // La temporal es la cédula del usuario (con cambio obligatorio al entrar).
      expect(temporaryPassword).toBe(userRow({ id }).cedula);
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

    it('también desbloquea la cuenta (contador y bloqueo en cero)', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(
        userRow({ id, intentosFallidos: 3, bloqueadoHasta: new Date(Date.now() + 60_000) }),
      );

      await service.resetPassword(id);

      expect(prisma.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ intentosFallidos: 0, bloqueadoHasta: null }),
        }),
      );
    });

    it('cuenta CDA sin correo: resetea sin intentar enviar el aviso', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ id, email: null }));

      const { user } = await service.resetPassword(id);

      expect(notifier.sendInitialPassword).not.toHaveBeenCalled();
      expect(user.email).toBeNull();
    });
  });

  describe('resetPasswordBulk', () => {
    const yo = '11111111-1111-1111-1111-111111111111';
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
    const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
    const fantasma = 'dddddddd-dddd-dddd-dddd-ddddddddddd3';

    it('restablece a cada usuario con su cédula y revoca sus sesiones', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([
        userRow({ id: a, cedula: '1000000001', email: null }),
        userRow({ id: b, cedula: '1000000002', email: null }),
      ]);

      const res = await service.resetPasswordBulk({ userIds: [a, b] }, yo);

      expect(res).toEqual({ restablecidos: 2, omitidos: [] });
      expect(prisma.usuario.update).toHaveBeenCalledTimes(2);
      expect(prisma.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: a },
          data: expect.objectContaining({ debeCambiarPwd: true, intentosFallidos: 0, bloqueadoHasta: null }),
        }),
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: b, revocadoEn: null },
        data: { revocadoEn: expect.any(Date) },
      });
    });

    it('nunca restablece la cuenta de quien lo pide (cerraría su propia sesión)', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([
        userRow({ id: yo, nombres: 'Admin', apellidos: 'Uno', email: null }),
        userRow({ id: a, email: null }),
      ]);

      const res = await service.resetPasswordBulk({ userIds: [yo, a] }, yo);

      expect(res.restablecidos).toBe(1);
      expect(res.omitidos).toEqual([{ id: yo, nombre: 'Admin Uno', motivo: 'Es su propia cuenta' }]);
      expect(prisma.usuario.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: yo } }));
    });

    it('los ids que no existen quedan como omitidos', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([userRow({ id: a, email: null })]);

      const res = await service.resetPasswordBulk({ userIds: [a, fantasma] }, yo);

      expect(res.restablecidos).toBe(1);
      expect(res.omitidos).toEqual([{ id: fantasma, nombre: null, motivo: 'Usuario no encontrado' }]);
    });

    it('si falla uno, sigue con los demás', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([
        userRow({ id: a, nombres: 'Ana', apellidos: 'Uno', email: null }),
        userRow({ id: b, email: null }),
      ]);
      prisma.$transaction.mockRejectedValueOnce(new Error('se cayó la conexión'));

      const res = await service.resetPasswordBulk({ userIds: [a, b] }, yo);

      expect(res.restablecidos).toBe(1);
      expect(res.omitidos).toEqual([{ id: a, nombre: 'Ana Uno', motivo: 'No se pudo restablecer' }]);
    });

    it('rechaza una lista vacía o con más de 500 usuarios', async () => {
      await expect(service.resetPasswordBulk({ userIds: [] }, yo)).rejects.toThrow(ZodError);
      const muchos = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
      await expect(service.resetPasswordBulk({ userIds: muchos }, yo)).rejects.toThrow(ZodError);
      expect(prisma.usuario.findMany).not.toHaveBeenCalled();
    });

    it('si falla el aviso por correo de uno, igual cuenta como restablecido y sigue', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([
        userRow({ id: a, email: 'a@cne.gob.ec' }),
        userRow({ id: b, email: null }),
      ]);
      notifier.sendInitialPassword.mockRejectedValueOnce(new Error('SMTP caído'));

      const res = await service.resetPasswordBulk({ userIds: [a, b] }, yo);

      expect(res).toEqual({ restablecidos: 2, omitidos: [] });
      expect(notifier.sendInitialPassword).toHaveBeenCalledTimes(1);
    });

    it('quita los ids repetidos', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([userRow({ id: a, email: null })]);

      const res = await service.resetPasswordBulk({ userIds: [a, a] }, yo);

      expect(res).toEqual({ restablecidos: 1, omitidos: [] });
      expect(prisma.usuario.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('desbloquear', () => {
    const id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

    it('lanza NotFoundException si el usuario no existe', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(null);

      await expect(service.desbloquear(id)).rejects.toThrow(NotFoundException);
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('pone el contador en cero, quita el bloqueo y devuelve el usuario', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ id }));
      prisma.usuario.update.mockResolvedValueOnce(userRow({ id, bloqueadoHasta: null }));

      const user = await service.desbloquear(id);

      expect(prisma.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id },
          data: { intentosFallidos: 0, bloqueadoHasta: null },
        }),
      );
      expect(user.bloqueadoHasta).toBeNull();
    });
  });

  describe('toUserDto (vía list)', () => {
    it('expone bloqueadoHasta en ISO y null si no está bloqueada', async () => {
      prisma.usuario.count.mockResolvedValueOnce(2);
      prisma.usuario.findMany.mockResolvedValueOnce([
        userRow({ bloqueadoHasta: new Date('2026-10-28T22:00:00Z') }),
        userRow({ bloqueadoHasta: null }),
      ]);

      const { items } = await service.list({});

      expect(items.map((u) => u.bloqueadoHasta)).toEqual(['2026-10-28T22:00:00.000Z', null]);
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
        '1034567899,uno@cne-imbabura.gob.ec,Ana,Lopez,',
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
