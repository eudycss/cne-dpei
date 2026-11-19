import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
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
/**
 * Ventana en la que un refresh token recién rotado aún se acepta si el cliente
 * no alcanzó a recibir su reemplazo (ver reemitirEnGracia).
 */
export const GRACIA_REFRESH_MS = 30_000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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
    const roles = user.roles.map((r) => r.rol.nombre as RoleName);
    // Los administradores no se bloquean: como el usuario es la cédula (casi
    // pública), cualquiera podría dejarlos fuera a propósito. Los protege el
    // límite de intentos por IP del controlador.
    const bloqueable = !roles.includes('ADMINISTRADOR');
    // Bloqueada: mismo mensaje genérico y no suma intentos (el bloqueo no se alarga).
    const bloqueada = bloqueable && user.bloqueadoHasta !== null && user.bloqueadoHasta > new Date();
    if (bloqueada) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (!ok) {
      if (bloqueable) await this.registrarIntentoFallido(user.id);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (user.intentosFallidos > 0 || user.bloqueadoHasta !== null) {
      await this.prisma.usuario.update({
        where: { id: user.id },
        data: { intentosFallidos: 0, bloqueadoHasta: null },
      });
    }

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
    if (!rec || rec.expiraEn < new Date()) {
      throw new UnauthorizedException('Refresh inválido');
    }
    const matches = await argon2.verify(rec.tokenHash, refreshToken);
    if (!matches) {
      throw new UnauthorizedException('Refresh inválido');
    }
    if (rec.revocadoEn && !this.enGracia(rec)) {
      throw new UnauthorizedException('Refresh inválido');
    }
    // Firmas y hash van fuera de la transacción (argon2 tarda): dentro solo
    // quedan las escrituras, así la fila del token nuevo existe siempre que
    // exista un puntero reemplazadoPorJti hacia ella.
    const nuevos = await this.prepararTokens({
      sub: payload.sub,
      email: payload.email,
      roles: payload.roles,
      debeCambiarPwd: payload.debeCambiarPwd,
    });
    await this.prisma.$transaction(async (tx) => {
      if (rec.revocadoEn) {
        await this.reemitirEnGracia(tx, rec, nuevos.fila.jti);
        this.logger.warn(
          `Refresh reemitido en margen de gracia: usuario=${rec.usuarioId} jti=${rec.jti} → ${nuevos.fila.jti}`,
        );
      } else {
        // Rotación: el where con revocadoEn: null hace la revocación atómica a
        // nivel de fila: de dos requests paralelas con el mismo token, solo una
        // actualiza 1 fila (ganadora) y la otra 0 (perdedora, sin tokens).
        const revocado = await tx.refreshToken.updateMany({
          where: { jti: rec.jti, revocadoEn: null },
          data: { revocadoEn: new Date(), reemplazadoPorJti: nuevos.fila.jti },
        });
        if (revocado.count === 0) {
          throw new UnauthorizedException('Refresh inválido');
        }
      }
      await tx.refreshToken.create({ data: nuevos.fila });
    });
    return { accessToken: nuevos.accessToken, refreshToken: nuevos.refreshToken };
  }

  /** Revocado por una rotación (no por logout/contraseña/desactivación) y hace poco. */
  private enGracia(rec: { revocadoEn: Date | null; reemplazadoPorJti: string | null }): boolean {
    if (!rec.revocadoEn || !rec.reemplazadoPorJti) return false;
    const transcurrido = Date.now() - rec.revocadoEn.getTime();
    return transcurrido >= 0 && transcurrido < GRACIA_REFRESH_MS;
  }

  /**
   * Margen de gracia: el cliente reenvía un refresh que el servidor ya rotó
   * pero cuya respuesta nunca le llegó (recargó la página o perdió señal a
   * mitad de la petición: en Render se ve como 499 y luego 401). Sin esto el
   * usuario queda fuera aunque nadie cerró su sesión.
   *
   * Solo se acepta si (1) lo revocó una rotación —no un logout, cambio de
   * contraseña ni desactivación—, (2) hace menos de GRACIA_REFRESH_MS y
   * (3) su reemplazo no fue revocado después (si lo fue, la sesión se cerró
   * a propósito). El reemplazo que nunca se entregó se revoca. Corre dentro
   * de la transacción de refresh(): cualquier excepción la revierte.
   */
  private async reemitirEnGracia(
    tx: Prisma.TransactionClient,
    rec: { jti: string; reemplazadoPorJti: string | null },
    nuevoJti: string,
  ): Promise<void> {
    const anterior = rec.reemplazadoPorJti!;
    // Compare-and-set sobre el original: de dos reintentos simultáneos solo
    // uno cambia el puntero y sigue; el otro actualiza 0 filas.
    const reapuntado = await tx.refreshToken.updateMany({
      where: { jti: rec.jti, reemplazadoPorJti: anterior },
      data: { reemplazadoPorJti: nuevoJti },
    });
    if (reapuntado.count === 0) {
      throw new UnauthorizedException('Refresh inválido');
    }
    // El reemplazo se creó en la misma transacción que fijó el puntero, así
    // que debe existir y seguir activo. Si ya está revocado (logout, cambio de
    // contraseña, desactivación o él mismo rotó), la sesión no se reabre.
    const revocado = await tx.refreshToken.updateMany({
      where: { jti: anterior, revocadoEn: null },
      data: { revocadoEn: new Date(), reemplazadoPorJti: nuevoJti },
    });
    if (revocado.count === 0) {
      throw new UnauthorizedException('Refresh inválido');
    }
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
    const { accessToken, refreshToken, fila } = await this.prepararTokens(payload);
    await this.prisma.refreshToken.create({ data: fila });
    return { accessToken, refreshToken };
  }

  /** Firma ambos tokens y arma la fila del refresh, sin escribir en la BD. */
  private async prepararTokens(payload: JwtPayload) {
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
    const fila = {
      usuarioId: payload.sub,
      jti,
      tokenHash: await argon2.hash(refreshToken),
      expiraEn: new Date(Date.now() + ttlToMs(refreshTtl)),
    };
    return { accessToken, refreshToken, fila };
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
