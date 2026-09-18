import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AllowPasswordChangePending, IS_PUBLIC_KEY, JwtAuthGuard } from './jwt-auth.guard';
import { ALLOW_PENDING_PASSWORD_CHANGE_KEY } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  const reflector = { getAllAndOverride: jest.fn() };
  let superCanActivate: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new JwtAuthGuard(reflector as unknown as Reflector);
    // JwtAuthGuard extends AuthGuard('jwt'); espiamos el canActivate heredado
    // (passport real haría el trabajo de validar el token) para poder probar
    // solo la lógica agregada (público / debeCambiarPwd) sin un JWT real.
    superCanActivate = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockResolvedValue(true);
  });

  function contextWithUser(user: { debeCambiarPwd: boolean } | undefined): ExecutionContext {
    const handler = () => undefined;
    const clazz = class {};
    return {
      getHandler: () => handler,
      getClass: () => clazz,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  it('permite el paso en una ruta @Public() sin llamar a super.canActivate ni revisar debeCambiarPwd', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => (key === IS_PUBLIC_KEY ? true : undefined));

    await expect(guard.canActivate(contextWithUser(undefined))).resolves.toBe(true);
    expect(superCanActivate).not.toHaveBeenCalled();
  });

  it('propaga el rechazo si super.canActivate() (JWT inválido/expirado) lanza', async () => {
    // AuthGuard('jwt').canActivate real (@nestjs/passport) nunca resuelve
    // false: o resuelve true o lanza (UnauthorizedException). Se prueba el
    // contrato real en vez de un `false` que passport nunca produce.
    reflector.getAllAndOverride.mockReturnValue(undefined);
    superCanActivate.mockRejectedValue(new UnauthorizedException());

    await expect(
      guard.canActivate(contextWithUser({ debeCambiarPwd: false })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('lanza ForbiddenException si el usuario tiene debeCambiarPwd=true en una ruta no exenta', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(
      guard.canActivate(contextWithUser({ debeCambiarPwd: true })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('permite el paso con debeCambiarPwd=true en una ruta marcada @AllowPasswordChangePending()', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === ALLOW_PENDING_PASSWORD_CHANGE_KEY ? true : undefined,
    );

    await expect(
      guard.canActivate(contextWithUser({ debeCambiarPwd: true })),
    ).resolves.toBe(true);
  });

  it('permite el paso normalmente si debeCambiarPwd=false', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(
      guard.canActivate(contextWithUser({ debeCambiarPwd: false })),
    ).resolves.toBe(true);
  });

  it('AllowPasswordChangePending() define la metadata ALLOW_PENDING_PASSWORD_CHANGE_KEY en el handler', () => {
    const descriptor: PropertyDescriptor = { value: () => undefined };
    AllowPasswordChangePending()({}, 'metodo', descriptor);
    expect(Reflect.getMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, descriptor.value)).toBe(true);
  });
});
