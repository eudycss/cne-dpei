import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/roles.decorator';
import { MochilasKitController } from './mochilas-kit.controller';

const rolesDe = (metodo: string) =>
  new Reflector().getAllAndOverride<string[]>(ROLES_KEY, [
    (MochilasKitController.prototype as any)[metodo],
    MochilasKitController,
  ]);

describe('MochilasKitController', () => {
  it.each(['plantilla', 'cargar', 'asignar'])('%s: solo el administrador', (metodo) => {
    expect(rolesDe(metodo)).toEqual(['ADMINISTRADOR']);
  });

  it('reporte: también técnico supervisor y lector (los mismos que ven la lista de kits)', () => {
    expect(rolesDe('reporte')).toEqual(['ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'LECTOR']);
  });

  it('cargar solo guarda con aplicar=true; con cualquier otro valor es vista previa', () => {
    const cargar = jest.fn().mockResolvedValue({});
    const ctrl = new MochilasKitController({ cargar } as never);
    const file = {} as Express.Multer.File;
    ctrl.cargar(file, 'ev', 'true', { sub: 'u1' } as never);
    ctrl.cargar(file, 'ev', '1', { sub: 'u1' } as never);
    ctrl.cargar(file, 'ev', undefined, { sub: 'u1' } as never);
    expect(cargar.mock.calls.map((c) => c[2])).toEqual([true, false, false]);
    expect(cargar).toHaveBeenCalledWith(file, 'ev', true, 'u1');
  });

  it('asignar pasa quién hizo el cambio', () => {
    const asignar = jest.fn().mockResolvedValue({});
    const ctrl = new MochilasKitController({ asignar } as never);
    ctrl.asignar('kit-1', { numero: 54 }, { sub: 'u1' } as never);
    expect(asignar).toHaveBeenCalledWith('kit-1', { numero: 54 }, 'u1');
  });
});
