import { BadRequestException, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  verify: jest.fn(),
}));
import * as argon2 from 'argon2';

import { AuthService, GRACIA_REFRESH_MS } from './auth.service';
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
      updateMany: jest.fn(),
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
      cedula: '1034567899',
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
    // Forma de arreglo y forma interactiva (callback con tx = el mismo mock).
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg as Promise<unknown>[]),
    );
    prisma.usuario.update.mockResolvedValue({ intentosFallidos: 1 });

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
    });

    it('verifica contra un hash señuelo si el usuario no existe (sin oráculo de tiempo)', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(null);
      verifyMock.mockResolvedValueOnce(false);
      await expect(service.login('1034567899', 'pw')).rejects.toThrow(UnauthorizedException);
      expect(verifyMock).toHaveBeenCalledTimes(1);
      expect(verifyMock).toHaveBeenCalledWith('hashed', 'pw');
    });

    it('lanza UnauthorizedException si el usuario está inactivo', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ activo: false }));
      await expect(service.login('op@cne-imbabura.gob.ec', 'pw')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rechaza al usuario inactivo aunque la contraseña sea correcta, tras verificarla', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ activo: false }));
      verifyMock.mockResolvedValueOnce(true);
      await expect(service.login('op@cne-imbabura.gob.ec', 'pw')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(verifyMock).toHaveBeenCalledTimes(1);
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

    it('busca por correo cuando el identificador lo contiene', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow());
      verifyMock.mockResolvedValueOnce(true);

      await service.login('op@cne-imbabura.gob.ec', 'buena');

      expect(prisma.usuario.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'op@cne-imbabura.gob.ec' } }),
      );
    });

    it('entra con cédula y la devuelve en los datos del usuario', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow());
      verifyMock.mockResolvedValueOnce(true);

      const result = await service.login('1034567899', 'buena');

      expect(prisma.usuario.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { cedula: '1034567899' } }),
      );
      expect(result.user.cedula).toBe('1034567899');
    });

    it('rechaza por cédula a un usuario inactivo', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ activo: false }));
      await expect(service.login('1034567899', 'buena')).rejects.toThrow('Credenciales inválidas');
    });

    it('rechaza por cédula una contraseña errónea', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow());
      verifyMock.mockResolvedValueOnce(false);
      await expect(service.login('1034567899', 'mala')).rejects.toThrow('Credenciales inválidas');
    });
  });

  describe('login: bloqueo por intentos fallidos', () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const QUINCE_MIN = 15 * 60_000;

    it('cada contraseña errónea suma un intento de forma atómica', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ intentosFallidos: 0, bloqueadoHasta: null }));
      verifyMock.mockResolvedValueOnce(false);

      await expect(service.login('1034567899', 'mala')).rejects.toThrow(UnauthorizedException);

      expect(prisma.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id }, data: { intentosFallidos: { increment: 1 } } }),
      );
      expect(prisma.usuario.updateMany).not.toHaveBeenCalled();
    });

    it('el 5.º fallo bloquea 15 minutos y reinicia el contador', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ intentosFallidos: 4, bloqueadoHasta: null }));
      verifyMock.mockResolvedValueOnce(false);
      prisma.usuario.update.mockResolvedValueOnce({ intentosFallidos: 5 });
      const antes = Date.now();

      await expect(service.login('1034567899', 'mala')).rejects.toThrow('Credenciales inválidas');

      const args = prisma.usuario.updateMany.mock.calls[0][0];
      expect(args.where).toEqual({ id, intentosFallidos: { gte: 5 } });
      expect(args.data.intentosFallidos).toBe(0);
      const hasta = (args.data.bloqueadoHasta as Date).getTime();
      expect(hasta).toBeGreaterThanOrEqual(antes + QUINCE_MIN);
      expect(hasta).toBeLessThanOrEqual(Date.now() + QUINCE_MIN);
    });

    it('bloqueada: rechaza aunque la contraseña sea correcta, verifica igual y no cuenta', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(
        userRow({ intentosFallidos: 0, bloqueadoHasta: new Date(Date.now() + 60_000) }),
      );
      verifyMock.mockResolvedValueOnce(true);

      await expect(service.login('1034567899', 'correcta')).rejects.toThrow('Credenciales inválidas');

      expect(verifyMock).toHaveBeenCalledTimes(1);
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('bloqueo vencido: entra y limpia el bloqueo', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(
        userRow({ intentosFallidos: 0, bloqueadoHasta: new Date(Date.now() - 1000) }),
      );
      verifyMock.mockResolvedValueOnce(true);

      await expect(service.login('1034567899', 'correcta')).resolves.toHaveProperty('accessToken');

      expect(prisma.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id }, data: { intentosFallidos: 0, bloqueadoHasta: null } }),
      );
    });

    it('éxito con fallos previos reinicia el contador', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ intentosFallidos: 3, bloqueadoHasta: null }));
      verifyMock.mockResolvedValueOnce(true);

      await service.login('1034567899', 'correcta');

      expect(prisma.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { intentosFallidos: 0, bloqueadoHasta: null } }),
      );
    });

    it('éxito sin fallos previos no escribe en la base', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ intentosFallidos: 0, bloqueadoHasta: null }));
      verifyMock.mockResolvedValueOnce(true);

      await service.login('1034567899', 'correcta');

      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('administrador: las contraseñas erróneas no cuentan (no se le puede dejar fuera a propósito)', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(
        userRow({ intentosFallidos: 4, bloqueadoHasta: null, roles: [{ rol: { nombre: 'ADMINISTRADOR' } }] }),
      );
      verifyMock.mockResolvedValueOnce(false);

      await expect(service.login('1034567899', 'mala')).rejects.toThrow('Credenciales inválidas');

      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(prisma.usuario.updateMany).not.toHaveBeenCalled();
    });

    it('administrador con un bloqueo previo vigente: entra con la contraseña correcta', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(
        userRow({
          intentosFallidos: 0,
          bloqueadoHasta: new Date(Date.now() + 60_000),
          roles: [{ rol: { nombre: 'ADMINISTRADOR' } }, { rol: { nombre: 'OPERADOR_CDA' } }],
        }),
      );
      verifyMock.mockResolvedValueOnce(true);

      await expect(service.login('1034567899', 'correcta')).resolves.toHaveProperty('accessToken');
    });

    it('cuenta sin correo (CDA): entra y el token lleva email null', async () => {
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow({ email: null, intentosFallidos: 0 }));
      verifyMock.mockResolvedValueOnce(true);

      const res = await service.login('1034567899', 'correcta');

      expect(res.user.email).toBeNull();
      expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ email: null }), expect.anything());
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

    it('rota el refresh: revoca el anterior (update atómico) y emite uno nuevo', async () => {
      jwt.verifyAsync.mockResolvedValueOnce(payload);
      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        jti: 'jti-1',
        tokenHash: 'h',
        revocadoEn: null,
        expiraEn: new Date(Date.now() + 10000),
      });
      verifyMock.mockResolvedValueOnce(true);
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.refresh('token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { jti: 'jti-1', revocadoEn: null },
        data: { revocadoEn: expect.any(Date), reemplazadoPorJti: expect.any(String) },
      });
      // El puntero del revocado, la fila creada y el JWT firmado usan el mismo jti.
      const nuevoJti = prisma.refreshToken.updateMany.mock.calls[0][0].data.reemplazadoPorJti;
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ jti: nuevoJti }),
      });
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ jti: nuevoJti }),
        expect.anything(),
      );
      // Revocar y crear van en la misma transacción.
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(result.accessToken).toBe('signed.jwt.token');
    });

    describe('margen de gracia (respuesta del refresh perdida: 499 → 401)', () => {
      const AHORA = new Date('2026-11-19T02:30:37Z').getTime();

      function revocadoPorRotacion(
        haceMs: number,
        reemplazadoPorJti: string | null = 'jti-2',
        expiraEn = new Date(AHORA + 10000),
      ) {
        return {
          jti: 'jti-1',
          usuarioId: payload.sub,
          tokenHash: 'h',
          revocadoEn: new Date(AHORA - haceMs),
          reemplazadoPorJti,
          expiraEn,
        };
      }

      let warn: jest.SpyInstance;

      /** Sin respuestas "Once" pendientes que se filtren de un caso a otro. */
      function limpiarColas() {
        prisma.refreshToken.findUnique.mockReset();
        prisma.refreshToken.updateMany.mockReset();
        prisma.refreshToken.create.mockReset();
      }

      beforeEach(() => {
        // Solo se congela Date (también `new Date()`); los timers siguen reales.
        jest.useFakeTimers({
          now: AHORA,
          doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'],
        });
        warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        limpiarColas();
        jwt.verifyAsync.mockResolvedValueOnce(payload);
        verifyMock.mockResolvedValueOnce(true);
      });

      afterEach(() => {
        jest.useRealTimers();
        warn.mockRestore();
        limpiarColas();
      });

      it('reemite si se rotó hace poco y el reemplazo sigue activo, y revoca ese reemplazo', async () => {
        prisma.refreshToken.findUnique.mockResolvedValueOnce(revocadoPorRotacion(2000));
        prisma.refreshToken.updateMany
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 });

        const result = await service.refresh('token');

        expect(result.accessToken).toBe('signed.jwt.token');
        const nuevoJti = prisma.refreshToken.create.mock.calls[0][0].data.jti;
        expect(prisma.refreshToken.updateMany).toHaveBeenNthCalledWith(1, {
          where: { jti: 'jti-1', reemplazadoPorJti: 'jti-2' },
          data: { reemplazadoPorJti: nuevoJti },
        });
        expect(prisma.refreshToken.updateMany).toHaveBeenNthCalledWith(2, {
          where: { jti: 'jti-2', revocadoEn: null },
          data: { revocadoEn: expect.any(Date), reemplazadoPorJti: nuevoJti },
        });
        expect(jwt.signAsync).toHaveBeenCalledWith(
          expect.objectContaining({ jti: nuevoJti }),
          expect.anything(),
        );
        // Queda rastro (sin tokens) para detectar abuso.
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(payload.sub));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('signed.jwt.token'));
      });

      it('acepta justo antes del límite y rechaza en GRACIA_REFRESH_MS exacto', async () => {
        prisma.refreshToken.findUnique.mockResolvedValueOnce(
          revocadoPorRotacion(GRACIA_REFRESH_MS - 1),
        );
        prisma.refreshToken.updateMany
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 });
        await expect(service.refresh('token')).resolves.toBeDefined();

        jwt.verifyAsync.mockResolvedValueOnce(payload);
        verifyMock.mockResolvedValueOnce(true);
        prisma.refreshToken.create.mockClear();
        prisma.refreshToken.findUnique.mockResolvedValueOnce(revocadoPorRotacion(GRACIA_REFRESH_MS));
        await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
        expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      });

      it('rechaza una revocación con fecha futura (desfase de reloj)', async () => {
        prisma.refreshToken.findUnique.mockResolvedValueOnce(revocadoPorRotacion(-5000));
        await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('rechaza un original ya expirado aunque la revocación sea reciente', async () => {
        prisma.refreshToken.findUnique.mockResolvedValueOnce(
          revocadoPorRotacion(2000, 'jti-2', new Date(AHORA - 1)),
        );
        await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
        expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      });

      it('rechaza un token revocado por logout, contraseña o desactivación (sin reemplazo)', async () => {
        prisma.refreshToken.findUnique.mockResolvedValueOnce(revocadoPorRotacion(2000, null));
        await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
        expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
        expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      });

      it('rechaza si el reemplazo ya no está activo (logout posterior, o él mismo ya rotó)', async () => {
        prisma.refreshToken.findUnique.mockResolvedValueOnce(revocadoPorRotacion(2000));
        prisma.refreshToken.updateMany
          .mockResolvedValueOnce({ count: 1 }) // CAS del original
          .mockResolvedValueOnce({ count: 0 }); // reemplazo ya revocado o inexistente
        await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
        // La excepción revierte la transacción: el token nuevo no se guarda.
        expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      });

      it('de dos reintentos simultáneos con el mismo token, solo uno reemite', async () => {
        prisma.refreshToken.findUnique.mockResolvedValueOnce(revocadoPorRotacion(2000));
        prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 }); // perdió el CAS
        await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
        expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      });

      it('no aplica la gracia si el hash del token no coincide', async () => {
        verifyMock.mockReset();
        verifyMock.mockResolvedValueOnce(false);
        prisma.refreshToken.findUnique.mockResolvedValueOnce(revocadoPorRotacion(2000));
        await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
        expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      });
    });

    it('lanza UnauthorizedException si dos refresh concurrentes usan el mismo token (condición de carrera)', async () => {
      // Ambas requests pasan la verificación inicial (revocadoEn aún null en la lectura),
      // pero el update atómico con where revocadoEn:null solo afecta 1 fila: la primera
      // gana (count 1), la segunda debe perder (count 0) y no emitir tokens nuevos.
      jwt.verifyAsync.mockResolvedValueOnce(payload);
      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        jti: 'jti-1',
        tokenHash: 'h',
        revocadoEn: null,
        expiraEn: new Date(Date.now() + 10000),
      });
      verifyMock.mockResolvedValueOnce(true);
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
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

    // El access token con el que llegó la request sigue firmado con
    // debeCambiarPwd=true hasta que expire — sin reemitir tokens acá,
    // JwtAuthGuard seguiría rechazando al usuario justo después de un
    // cambio de contraseña exitoso (ver jwt-auth.guard.ts).
    it('reemite tokens frescos con debeCambiarPwd=false', async () => {
      prisma.usuario.findUniqueOrThrow.mockResolvedValueOnce(userRow());
      verifyMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const result = await service.changePassword(userId, 'actual', 'Nueva1*');

      expect(result).toEqual({ accessToken: 'signed.jwt.token', refreshToken: 'signed.jwt.token' });
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: userId, debeCambiarPwd: false, roles: ['OPERADOR_CDA'] }),
        expect.anything(),
      );
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

    it('usa solo el primer origen cuando WEB_ORIGIN trae varios separados por coma (CORS)', async () => {
      config.get.mockReturnValueOnce(
        'https://cne-dpei-web.vercel.app,http://localhost:5173',
      );
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow());
      await service.forgotPassword('op@cne-imbabura.gob.ec');
      const [, link] = notifier.sendPasswordResetLink.mock.calls[0];
      expect(link).toBe(
        `https://cne-dpei-web.vercel.app/reset-password?token=${
          (link as string).split('token=')[1]
        }`,
      );
      expect(link).not.toContain(',');
    });

    it('ignora segmentos vacíos en WEB_ORIGIN (ej. coma inicial) y no rompe el enlace', async () => {
      config.get.mockReturnValueOnce(',https://cne-dpei-web.vercel.app');
      prisma.usuario.findUnique.mockResolvedValueOnce(userRow());
      await service.forgotPassword('op@cne-imbabura.gob.ec');
      const [, link] = notifier.sendPasswordResetLink.mock.calls[0];
      expect(link).toMatch(/^https:\/\/cne-dpei-web\.vercel\.app\/reset-password\?token=/);
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
