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
import type { ChangePasswordResponse, LoginResponse, RoleName } from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';
import type { JwtPayload } from './jwt.strategy';
import { INotifier, NOTIFIER } from './notifier';
import { parseWebOrigins } from '../common/web-origin.util';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora (HU16-CA3)
/** Contraseñas erróneas seguidas antes de bloquear la cuenta. */
export const MAX_INTENTOS_LOGIN = 5;
export const BLOQUEO_LOGIN_MS = 15 * 60_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(NOTIFIER) private readonly notifier: INotifier,
  ) {}

  /** `usuario` llega ya validado por loginSchema: cédula de 10 dígitos o correo. */
  async login(usuario: string, password: string): Promise<LoginResponse> {
    const where = usuario.includes('@') ? { email: usuario } : { cedula: usuario };
    const user = await this.prisma.usuario.findUnique({
      where,
      include: { roles: { include: { rol: true } } },
    });
    // Siempre se ejecuta argon2.verify (contra un hash señuelo si no hay usuario)
    // para que el tiempo de respuesta no revele qué cédulas o correos existen.
    const ok = await argon2.verify(user?.passwordHash ?? (await this.hashSenuelo()), password);
    if (!user || !user.activo) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    // Bloqueada: mismo mensaje genérico y no suma intentos (el bloqueo no se alarga).
    const bloqueada = user.bloqueadoHasta !== null && user.bloqueadoHasta > new Date();
    if (bloqueada) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (!ok) {
      await this.registrarIntentoFallido(user.id);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (user.intentosFallidos > 0 || user.bloqueadoHasta !== null) {
      await this.prisma.usuario.update({
        where: { id: user.id },
        data: { intentosFallidos: 0, bloqueadoHasta: null },
      });
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
        cedula: user.cedula,
        email: user.email,
        nombres: user.nombres,
        apellidos: user.apellidos,
        debeCambiarPwd: user.debeCambiarPwd,
        roles,
      },
    };
  }

  /**
   * Suma un intento con `increment` (atómico ante intentos en paralelo) y, al
   * llegar al máximo, bloquea la cuenta. El `gte` del updateMany hace que dos
   * fallos simultáneos que llegan al máximo bloqueen una sola vez.
   */
  private async registrarIntentoFallido(id: string): Promise<void> {
    const { intentosFallidos } = await this.prisma.usuario.update({
      where: { id },
      data: { intentosFallidos: { increment: 1 } },
      select: { intentosFallidos: true },
    });
    if (intentosFallidos >= MAX_INTENTOS_LOGIN) {
      await this.prisma.usuario.updateMany({
        where: { id, intentosFallidos: { gte: MAX_INTENTOS_LOGIN } },
        data: { intentosFallidos: 0, bloqueadoHasta: new Date(Date.now() + BLOQUEO_LOGIN_MS) },
      });
    }
  }

  private hashSenueloPromise?: Promise<string>;

  /** Hash argon2 de un valor aleatorio, calculado una vez por instancia. */
  private hashSenuelo(): Promise<string> {
    this.hashSenueloPromise ??= argon2.hash(crypto.randomUUID());
    return this.hashSenueloPromise;
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
    // Rotación: invalidamos el anterior y emitimos uno nuevo. El where con
    // revocadoEn: null hace que la revocación sea atómica a nivel de fila: si
    // dos requests llegan en paralelo con el mismo refresh token, solo una
    // actualiza 0 filas (perdedora) y la otra 1 (ganadora). Un update sin esa
    // condición deja que ambas "ganen" y emitan tokens nuevos.
    const revocado = await this.prisma.refreshToken.updateMany({
      where: { jti: payload.jti, revocadoEn: null },
      data: { revocadoEn: new Date() },
    });
    if (revocado.count === 0) {
      throw new UnauthorizedException('Refresh inválido');
    }
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
  ): Promise<ChangePasswordResponse> {
    const user = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: { include: { rol: true } } },
    });
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

    // El access token con el que llegó esta request sigue firmado con
    // debeCambiarPwd=true hasta que expire (hasta 15 min) — JwtAuthGuard lo
    // seguiría rechazando en cualquier ruta no exenta. Reemitimos tokens acá
    // (igual que login/refresh) para que el cliente los adopte de inmediato.
    const roles = user.roles.map((r) => r.rol.nombre as RoleName);
    return this.issueTokens({ sub: user.id, email: user.email, roles, debeCambiarPwd: false });
  }

  /** HU16: emite token de recuperación. No revela si el email existe. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.usuario.findUnique({ where: { email } });
    // `!user.email` solo para el tipo: se buscó por correo, así que lo tiene.
    if (!user || !user.activo || !user.email) {
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
    const baseUrl = parseWebOrigins(webOrigin)[0] ?? 'http://localhost:5173';
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
