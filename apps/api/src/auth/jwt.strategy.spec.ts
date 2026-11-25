import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { ACTIVO_CACHE_MS, JwtStrategy, type JwtPayload } from './jwt.strategy';
import type { PrismaService } from '../db/prisma.service';

const USR = 'uuuuuuuu-uuuu-uuuu-uuuu-uuuuuuuuuuuu';
const payload: JwtPayload = { sub: USR, email: null, roles: ['OPERADOR_CDA'], debeCambiarPwd: false };

describe('JwtStrategy', () => {
  const findUnique = jest.fn();
  const prisma = { usuario: { findUnique } } as unknown as PrismaService;
  const config = { get: jest.fn().mockReturnValue('secreto-de-prueba') } as unknown as ConfigService;
  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: new Date('2026-11-24T12:00:00Z') });
    strategy = new JwtStrategy(config, prisma);
  });

  afterEach(() => jest.useRealTimers());

  it('sin JWT_ACCESS_SECRET no arranca', () => {
    const sinSecreto = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    expect(() => new JwtStrategy(sinSecreto, prisma)).toThrow('JWT_ACCESS_SECRET no configurado');
  });

  it('token sin sub: 401 sin consultar la base', async () => {
    await expect(strategy.validate({ ...payload, sub: '' })).rejects.toThrow(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('usuario activo: devuelve el payload', async () => {
    findUnique.mockResolvedValueOnce({ activo: true });
    await expect(strategy.validate(payload)).resolves.toEqual(payload);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: USR }, select: { activo: true } });
  });

  it('usuario desactivado con access token vigente: 401', async () => {
    findUnique.mockResolvedValueOnce({ activo: false });
    await expect(strategy.validate(payload)).rejects.toThrow('Usuario inactivo');
  });

  it('usuario borrado: 401', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });

  it('recuerda que está activo 30 s: no consulta la base en cada pedido', async () => {
    findUnique.mockResolvedValue({ activo: true });
    await strategy.validate(payload);
    jest.advanceTimersByTime(ACTIVO_CACHE_MS - 1);
    await strategy.validate(payload);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('pasados 30 s vuelve a consultar: si lo desactivaron, ya no pasa', async () => {
    findUnique.mockResolvedValueOnce({ activo: true });
    await strategy.validate(payload);

    jest.advanceTimersByTime(ACTIVO_CACHE_MS);
    findUnique.mockResolvedValueOnce({ activo: false });
    await expect(strategy.validate(payload)).rejects.toThrow('Usuario inactivo');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('un inactivo no queda recordado: si lo reactivan, pasa en el siguiente pedido', async () => {
    findUnique.mockResolvedValueOnce({ activo: false });
    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);

    findUnique.mockResolvedValueOnce({ activo: true });
    await expect(strategy.validate(payload)).resolves.toEqual(payload);
  });

  it('si la base falla, no deja pasar (el error sube y el pedido no se atiende)', async () => {
    findUnique.mockRejectedValueOnce(new Error('BD caída'));
    await expect(strategy.validate(payload)).rejects.toThrow('BD caída');
  });
});
