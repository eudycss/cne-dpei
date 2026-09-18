import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from './current-user.decorator';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
  if (descriptor) {
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, descriptor.value);
  } else {
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, target);
  }
};

export const ALLOW_PENDING_PASSWORD_CHANGE_KEY = 'allowPendingPasswordChange';
/**
 * Excepción al bloqueo de debeCambiarPwd (ver JwtAuthGuard): solo debe usarse
 * en las rutas que un usuario con cambio de contraseña obligatorio pendiente
 * todavía necesita poder llamar, hoy /auth/logout y /auth/change-password.
 */
export const AllowPasswordChangePending = () =>
  (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true, descriptor.value);
    } else {
      Reflect.defineMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true, target);
    }
  };

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const authorized = await super.canActivate(context);
    if (!authorized) {
      return false;
    }

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowPending) {
      return true;
    }

    const user: AuthenticatedUser | undefined = context.switchToHttp().getRequest().user;
    if (user?.debeCambiarPwd) {
      throw new ForbiddenException('Debes cambiar tu contraseña antes de continuar');
    }

    return true;
  }
}
