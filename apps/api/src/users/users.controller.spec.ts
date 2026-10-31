import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/roles.decorator';
import { UsersController } from './users.controller';

// Lo mismo que resuelve RolesGuard: primero el método, luego la clase.
const rolesDe = (metodo: keyof UsersController) =>
  new Reflector().getAllAndOverride<string[]>(ROLES_KEY, [UsersController.prototype[metodo], UsersController]);

describe('UsersController RBAC', () => {
  it('solo el administrador restablece claves en bloque', () => {
    expect(rolesDe('resetPasswordBulk')).toEqual(['ADMINISTRADOR']);
  });

  it('pasa como solicitante al usuario autenticado', () => {
    const users = { resetPasswordBulk: jest.fn().mockResolvedValue({ restablecidos: 0, omitidos: [] }) };
    const ctrl = new UsersController(users as any);
    const body = { userIds: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'] };

    ctrl.resetPasswordBulk(body, { sub: 'yo', email: null, roles: ['ADMINISTRADOR'], debeCambiarPwd: false });

    expect(users.resetPasswordBulk).toHaveBeenCalledWith(body, 'yo');
  });
});
