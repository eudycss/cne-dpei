import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { RoleName } from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';

export interface JwtPayload {
  sub: string;
  /** null en cuentas de Operadores/Asistentes CDA (entran con cédula). */
  email: string | null;
  roles: RoleName[];
  debeCambiarPwd: boolean;
}

/**
 * Cuánto se recuerda que un usuario sigue activo. Acota a 30 s (en vez de los
 * 15 min del access token) el tiempo que alguien desactivado puede seguir
 * usando la API, con a lo sumo una consulta por usuario cada 30 s.
 */
export const ACTIVO_CACHE_MS = 30_000;
/** Tope de entradas: con más usuarios distintos se vacía (memoria acotada en Render free). */
const ACTIVO_CACHE_MAX = 5_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  /** usuarioId → hasta cuándo (epoch ms) vale el "sigue activo". Solo se guardan los activos. */
  private readonly activos = new Map<string, number>();

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET no configurado');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload?.sub) {
      throw new UnauthorizedException('Token inválido');
    }
    if (!(await this.sigueActivo(payload.sub))) {
      throw new UnauthorizedException('Usuario inactivo');
    }
    return payload;
  }

  /** Un usuario desactivado (o borrado) deja de pasar aunque su access token no haya vencido. */
  private async sigueActivo(usuarioId: string): Promise<boolean> {
    const ahora = Date.now();
    const hasta = this.activos.get(usuarioId);
    if (hasta !== undefined && hasta > ahora) return true;

    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { activo: true } });
    if (!usuario?.activo) {
      this.activos.delete(usuarioId);
      return false;
    }
    if (this.activos.size >= ACTIVO_CACHE_MAX) this.activos.clear();
    this.activos.set(usuarioId, ahora + ACTIVO_CACHE_MS);
    return true;
  }
}
