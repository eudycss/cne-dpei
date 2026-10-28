import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/roles.decorator';
import { CuentasCdaController } from './cuentas-cda.controller';

const rolesDe = (metodo: string) =>
  new Reflector().getAllAndOverride<string[]>(ROLES_KEY, [
    (CuentasCdaController.prototype as never)[metodo],
    CuentasCdaController,
  ]);

describe('CuentasCdaController', () => {
  it.each(['resumen', 'sincronizar', 'desactivarSinVinculo'])('%s: solo administrador', (metodo) => {
    expect(rolesDe(metodo)).toEqual(['ADMINISTRADOR']);
  });

  it('delega en el servicio', async () => {
    const cuentas = {
      resumen: jest.fn().mockResolvedValue({ conCuenta: 1 }),
      sincronizar: jest.fn().mockResolvedValue({ vinculadas: 1, creadas: 2 }),
      desactivarSinVinculo: jest.fn().mockResolvedValue({ desactivadas: 3 }),
    };
    const ctrl = new CuentasCdaController(cuentas as never);

    await expect(ctrl.resumen()).resolves.toEqual({ conCuenta: 1 });
    await expect(ctrl.sincronizar()).resolves.toEqual({ vinculadas: 1, creadas: 2 });
    await expect(ctrl.desactivarSinVinculo()).resolves.toEqual({ desactivadas: 3 });
    // El botón de la web procesa a todos: sin filtro.
    expect(cuentas.sincronizar).toHaveBeenCalledWith();
  });
});
