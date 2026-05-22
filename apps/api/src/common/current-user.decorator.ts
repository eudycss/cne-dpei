import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RoleName } from '@cne/shared-types';

export interface AuthenticatedUser {
  sub: string;
  email: string;
  roles: RoleName[];
  debeCambiarPwd: boolean;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    return data ? req.user?.[data] : req.user;
  },
);
