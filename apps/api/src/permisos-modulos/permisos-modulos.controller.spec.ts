import { Reflector } from '@nestjs/core';
import { actualizarModulosRolSchema } from '@cne/shared-validation';
import { ROLES_KEY } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { PermisosModulosController } from './permisos-modulos.controller';

const rolesDe = (metodo: string) =>
  new Reflector().getAllAndOverride<string[]>(ROLES_KEY, [
    (PermisosModulosController.prototype as any)[metodo],
    PermisosModulosController,
  ]);

describe('PermisosModulosController', () => {
  it.each(['matriz', 'actualizar'])('%s: solo el administrador ve o cambia la configuración', (metodo) => {
    expect(rolesDe(metodo)).toEqual(['ADMINISTRADOR']);
  });

  it('mios: sin @Roles, cualquier autenticado consulta solo los módulos de sus propios roles', () => {
    expect(rolesDe('misModulos')).toBeUndefined();
    const misModulos = jest.fn().mockResolvedValue({ modulos: [] });
    const ctrl = new PermisosModulosController({ misModulos } as never);
    ctrl.misModulos({ id: 'u', roles: ['LECTOR'] } as never);
    expect(misModulos).toHaveBeenCalledWith(['LECTOR']);
  });

  it('actualizar pasa el rol de la ruta y los módulos validados al servicio', () => {
    const actualizar = jest.fn().mockResolvedValue({});
    const ctrl = new PermisosModulosController({ actualizar } as never);
    ctrl.actualizar('LECTOR', { modulos: ['inicio'] });
    expect(actualizar).toHaveBeenCalledWith('LECTOR', ['inicio']);
  });

  it('el cuerpo se valida: rechaza ids fuera del catálogo o sin "modulos", y quita repetidos', () => {
    const pipe = new ZodValidationPipe(actualizarModulosRolSchema);
    const meta = { type: 'body' } as const;
    expect(() => pipe.transform({ modulos: ['inicio', 'no-existe'] }, meta)).toThrow();
    expect(() => pipe.transform({}, meta)).toThrow();
    expect(() => pipe.transform({ modulos: 'inicio' }, meta)).toThrow();
    expect(pipe.transform({ modulos: ['inicio', 'inicio', 'kits'] }, meta)).toEqual({ modulos: ['inicio', 'kits'] });
  });
});
