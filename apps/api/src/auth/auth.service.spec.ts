import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  verify: jest.fn(),
}));
import * as argon2 from 'argon2';

import { AuthService } from './auth.service';
import { PrismaService } from '../db/prisma.service';
import { NOTIFIER } from './notifier';

const verifyMock = argon2.verify as jest.Mock;

describe('AuthService', () => {
  let service: AuthService;

  const prisma = {
    usuario: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    passwordResetToken: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };

  const jwt = {
    signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    verifyAsync: jest.fn(),
  };

  const config = {
    get: jest.fn().mockReturnValue(undefined),
    getOrThrow: jest.fn().mockReturnValue('secret'),
  };

  const notifier = {
    sendPasswordResetLink: jest.fn().mockResolvedValue(undefined),
    sendInitialPassword: jest.fn().mockResolvedValue(undefined),
  };

  function userRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      email: 'op@cne-imbabura.gob.ec',
      nombres: 'Ana',
      apellidos: 'López',
      passwordHash: 'hash-actual',
      activo: true,
      debeCambiarPwd: false,
      roles: [{ rol: { nombre: 'OPERADOR_CDA' } }],
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    verifyMock.mockReset();
    (argon2.hash as jest.Mock).mockResolvedValue('hashed');
    jwt.signAsync.mockResolvedValue('signed.jwt.token');
    config.getOrThrow.mockReturnValue('secret');
    config.get.mockReturnValue(undefined);
    prisma.$transaction.mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr));

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
        { provide: NOTIFIER, useValue: notifier },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('lanza UnauthorizedException si el usuario no existe', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(null);
      await expect(service.login('x@x.com', 'pw')).rejects.toThrow(UnauthorizedException);
      expect(verifyMock).not.toHaveBeenCalled();
    });

    it('lanza UnauthorizedException si el usuario está inactivo', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ activo: false }));
      await expect(service.login('op@cne-imbabura.gob.ec', 'pw')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lanza UnauthorizedException si la contraseña no coincide', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow());
      verifyMock.mockResolvedValueOnce(false);
      await expect(service.login('op@cne-imbabura.gob.ec', 'mala')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('devuelve tokens y datos del usuario en credenciales válidas', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow());
      verifyMock.mockResolvedValueOnce(true);

      const result = await service.login('op@cne-imbabura.gob.ec', 'buena');

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBe('signed.jwt.token');
      expect(result.user.roles).toEqual(['OPERADOR_CDA']);
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1); // persiste el refresh emitido
    });
  });

  describe('refresh', () => {
    const payload = {
      sub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      email: 'op@cne-imbabura.gob.ec',
      roles: ['OPERADOR_CDA'],
      debeCambiarPwd: false,
      jti: 'jti-1',
    };

    it('lanza UnauthorizedException si el token no es verificable', async () => {
      jwt.verifyAsync.mockRejectedValueOnce(new Error('bad'));
      await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
    });

    it('lanza UnauthorizedException si el registro fue revocado', async () => {
      jwt.verifyAsync.mockResolvedValueOnce(payload);
      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        jti: 'jti-1',
        tokenHash: 'h',
        revocadoEn: new Date(),
        expiraEn: new Date(Date.now() + 10000),
      });
      await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
    });

    it('lanza UnauthorizedException si el hash del token no coincide', async () => {
      jwt.verifyAsync.mockResolvedValueOnce(payload);
      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        jti: 'jti-1',
        tokenHash: 'h',
        revocadoEn: null,
        expiraEn: new Date(Date.now() + 10000),
      });
      verifyMock.mockResolvedValueOnce(false);
      await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
    });

    it('rota el refresh: revoca el anterior y emite uno nuevo', async () => {
      jwt.verifyAsync.mockResolvedValueOnce(payload);
      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        jti: 'jti-1',
        tokenHash: 'h',
        revocadoEn: null,
        expiraEn: new Date(Date.now() + 10000),
      });
      verifyMock.mockResolvedValueOnce(true);

      const result = await service.refresh('token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { jti: 'jti-1' },
        data: { revocadoEn: expect.any(Date) },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(result.accessToken).toBe('signed.jwt.token');
    });
  });

  describe('changePassword', () => {
    const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    it('lanza BadRequestException si la contraseña actual es incorrecta', async () => {
      prisma.usuario.findUniqueOrThrow.mockResolvedValueOnce(userRow());
      verifyMock.mockResolvedValueOnce(false); // current incorrecta
      await expect(service.changePassword(userId, 'mala', 'Nueva1*')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si la nueva contraseña es igual a la actual', async () => {
      prisma.usuario.findUniqueOrThrow.mockResolvedValueOnce(userRow());
      verifyMock.mockResolvedValueOnce(true).mockResolvedValueOnce(true); // current ok, new == actual
      await expect(service.changePassword(userId, 'actual', 'actual')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('cambia la contraseña y revoca las sesiones activas', async () => {
      prisma.usuario.findUniqueOrThrow.mockResolvedValueOnce(userRow());
      verifyMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false); // current ok, new distinta

      await service.changePassword(userId, 'actual', 'Nueva1*');

      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { passwordHash: 'hashed', debeCambiarPwd: false },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: userId, revocadoEn: null },
        data: { revocadoEn: expect.any(Date) },
      });
    });
  });

  describe('forgotPassword', () => {
    it('no crea token ni notifica si el email no existe (respuesta genérica)', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(null);
      await service.forgotPassword('noexiste@x.com');
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(notifier.sendPasswordResetLink).not.toHaveBeenCalled();
    });

    it('crea token de recuperación y envía el enlace si el email existe', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow());
      await service.forgotPassword('op@cne-imbabura.gob.ec');
      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      expect(notifier.sendPasswordResetLink).toHaveBeenCalledTimes(1);
      const [, link] = notifier.sendPasswordResetLink.mock.calls[0];
      expect(link).toContain('/reset-password?token=');
    });
  });

  describe('resetPassword', () => {
    it('lanza BadRequestException si ningún token candidato coincide', async () => {
      prisma.passwordResetToken.findMany.mockResolvedValueOnce([
        { id: 't1', usuarioId: 'u1', tokenHash: 'h1' },
      ]);
      verifyMock.mockResolvedValueOnce(false); // no coincide
      await expect(service.resetPassword('token', 'Nueva1*')).rejects.toThrow(BadRequestException);
    });

    it('actualiza la contraseña, marca el token usado y revoca sesiones', async () => {
      prisma.passwordResetToken.findMany.mockResolvedValueOnce([
        { id: 't1', usuarioId: 'u1', tokenHash: 'h1' },
      ]);
      verifyMock.mockResolvedValueOnce(true); // coincide

      await service.resetPassword('token', 'Nueva1*');

      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { passwordHash: 'hashed', debeCambiarPwd: false },
      });
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { usado: true },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: 'u1', revocadoEn: null },
        data: { revocadoEn: expect.any(Date) },
      });
    });
  });

  describe('logout', () => {
    it('revoca todos los refresh tokens activos del usuario', async () => {
      await service.logout('u1');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: 'u1', revocadoEn: null },
        data: { revocadoEn: expect.any(Date) },
      });
    });
  });
});
