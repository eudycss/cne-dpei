import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { LoginResponse, RoleName } from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';
import type { JwtPayload } from './jwt.strategy';
import { INotifier, NOTIFIER } from './notifier';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora (HU16-CA3)

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(NOTIFIER) private readonly notifier: INotifier,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.prisma.usuario.findUnique({
      where: { email },
      include: { roles: { include: { rol: true } } },
    });
    if (!user || !user.activo) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const roles = user.roles.map((r) => r.rol.nombre as RoleName);
    const tokens = await this.issueTokens({
      sub: user.id,
      email: user.email,
      roles,
      debeCambiarPwd: user.debeCambiarPwd,
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        nombres: user.nombres,
        apellidos: user.apellidos,
        debeCambiarPwd: user.debeCambiarPwd,
        roles,
      },
    };
  }

  async refresh(refreshToken: string) {
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    let payload: JwtPayload & { jti: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: refreshSecret });
    } catch {
      throw new UnauthorizedException('Refresh inválido');
    }
    const rec = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
    });
    if (!rec || rec.revocadoEn || rec.expiraEn < new Date()) {
      throw new UnauthorizedException('Refresh inválido');
    }
    const matches = await argon2.verify(rec.tokenHash, refreshToken);
    if (!matches) {
      throw new UnauthorizedException('Refresh inválido');
    }
    // Rotación: invalidamos el anterior y emitimos uno nuevo
    await this.prisma.refreshToken.update({
      where: { jti: payload.jti },
      data: { revocadoEn: new Date() },
    });
    return this.issueTokens({
      sub: payload.sub,
      email: payload.email,
      roles: payload.roles,
      debeCambiarPwd: payload.debeCambiarPwd,
    });
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { usuarioId: userId, revocadoEn: null },
      data: { revocadoEn: new Date() },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.usuario.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, currentPassword);
    if (!ok) {
      throw new BadRequestException('Contraseña actual incorrecta');
    }
    if (await argon2.verify(user.passwordHash, newPassword)) {
      throw new BadRequestException('La nueva contraseña no puede ser igual a la actual');
    }
    const newHash = await argon2.hash(newPassword);
    await this.prisma.usuario.update({
      where: { id: userId },
      data: { passwordHash: newHash, debeCambiarPwd: false },
    });
    // Invalidamos refresh tokens existentes por seguridad
    await this.prisma.refreshToken.updateMany({
      where: { usuarioId: userId, revocadoEn: null },
      data: { revocadoEn: new Date() },
    });
  }

  /** HU16: emite token de recuperación. No revela si el email existe. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.usuario.findUnique({ where: { email } });
    if (!user || !user.activo) {
      // HU16-CA5: respuesta genérica
      return;
    }
    const raw = crypto.randomBytes(32).toString('hex');
    const hash = await argon2.hash(raw);
    await this.prisma.passwordResetToken.create({
      data: {
        usuarioId: user.id,
        tokenHash: hash,
        expiraEn: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    const webOrigin = this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:5173';
    const baseUrl = webOrigin.split(',')[0].trim();
    const link = `${baseUrl}/reset-password?token=${raw}`;
    await this.notifier.sendPasswordResetLink(user.email, link);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    // Buscamos tokens no usados aún válidos y verificamos con argon2
    const candidatos = await this.prisma.passwordResetToken.findMany({
      where: { usado: false, expiraEn: { gt: new Date() } },
      orderBy: { creadoEn: 'desc' },
      take: 50,
    });
    let matched: (typeof candidatos)[number] | null = null;
    for (const c of candidatos) {
      if (await argon2.verify(c.tokenHash, token)) {
        matched = c;
        break;
      }
    }
    if (!matched) {
      throw new BadRequestException('Enlace de recuperación inválido o expirado');
    }
    const hash = await argon2.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.usuario.update({
        where: { id: matched.usuarioId },
        data: { passwordHash: hash, debeCambiarPwd: false },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: matched.id },
        data: { usado: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { usuarioId: matched.usuarioId, revocadoEn: null },
        data: { revocadoEn: new Date() },
      }),
    ]);
  }

  // ---- internos ----------------------------------------------------------

  private async issueTokens(payload: JwtPayload) {
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';
    const accessSecret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');

    const accessToken = await this.jwt.signAsync(payload, {
      secret: accessSecret,
      expiresIn: accessTtl,
    });
    const jti = uuidv4();
    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti },
      { secret: refreshSecret, expiresIn: refreshTtl },
    );
    const hash = await argon2.hash(refreshToken);
    const expiraEn = new Date(Date.now() + ttlToMs(refreshTtl));
    await this.prisma.refreshToken.create({
      data: {
        usuarioId: payload.sub,
        jti,
        tokenHash: hash,
        expiraEn,
      },
    });
    return { accessToken, refreshToken };
  }
}

function ttlToMs(ttl: string): number {
  const m = ttl.match(/^(\d+)([smhd])$/);
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  switch (m[2]) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}
