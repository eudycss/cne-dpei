import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/roles.decorator';
import { IS_PUBLIC_KEY } from '../common/jwt-auth.guard';
import { MODULO_KEY } from '../permisos-modulos/modulo.guard';
import { SimuladorController, SimuladorPublicoController } from './simulador.controller';

// eslint-disable-next-line @typescript-eslint/ban-types
const metodo = (ctrl: object, nombre: string) => (ctrl as Record<string, Function>)[nombre];

/** Límite por minuto que @Throttle dejó en el método (el nombre exacto de la clave lo pone @nestjs/throttler). */
function limiteDe(nombre: string): number | undefined {
  const fn = metodo(SimuladorPublicoController.prototype, nombre);
  const clave = Reflect.getMetadataKeys(fn).find((k) => String(k).includes('LIMIT') && String(k).includes('default'));
  return clave ? Reflect.getMetadata(clave, fn) : undefined;
}

describe('SimuladorController (administración)', () => {
  it('techo de roles y módulo en toda la clase; no es público', () => {
    const r = new Reflector();
    expect(r.get(ROLES_KEY, SimuladorController)).toEqual(['ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL']);
    expect(r.get(MODULO_KEY, SimuladorController)).toBe('simulador-digitacion');
    for (const m of Object.getOwnPropertyNames(SimuladorController.prototype).filter((n) => n !== 'constructor')) {
      expect(r.getAllAndOverride(IS_PUBLIC_KEY, [metodo(SimuladorController.prototype, m), SimuladorController])).toBeFalsy();
    }
  });
});

describe('SimuladorController.buscarPersonas', () => {
  it('?q como arreglo se trata como vacío', async () => {
    const practicas = { buscarPersonas: jest.fn().mockResolvedValue([]) };
    const ctrl = new SimuladorController(practicas as never);
    await ctrl.buscarPersonas(['a', 'b']);
    expect(practicas.buscarPersonas).toHaveBeenCalledWith('');
  });

  it('tiene límite por IP', () => {
    const fn = metodo(SimuladorController.prototype, 'buscarPersonas');
    const clave = Reflect.getMetadataKeys(fn).find((k) => String(k).includes('LIMIT') && String(k).includes('default'));
    expect(Reflect.getMetadata(clave, fn)).toBe(120);
  });
});

describe('SimuladorPublicoController', () => {
  it('es público (sin sesión)', () => {
    expect(new Reflector().get(IS_PUBLIC_KEY, SimuladorPublicoController)).toBe(true);
  });

  it.each([
    ['ingresar', 60],
    ['iniciar', 60],
    ['estado', 600],
    ['nuevaActa', 400],
    ['guardar', 400],
    ['borrador', 900],
  ])('%s: límite por IP de %i por minuto', (nombre, limite) => {
    expect(limiteDe(nombre)).toBe(limite);
  });

  it('iniciar no devuelve el id de la persona ni si fue retomado; los deja en la request para la bitácora', async () => {
    const servicio = {
      iniciar: jest.fn().mockResolvedValue({ token: 't', estado: { terminado: false }, operadorId: 'op-1', retomado: true }),
    };
    const ctrl = new SimuladorPublicoController(servicio as never);
    const req = {} as Record<string, unknown>;
    const r = await ctrl.iniciar(req as never, { cedula: '1710034065', practicaId: 'p' });
    expect(r).toEqual({ token: 't', estado: { terminado: false } });
    expect(req).toMatchObject({ operadorCdaId: 'op-1', simuladorRetomado: true });
    expect(servicio.iniciar).toHaveBeenCalledWith('1710034065', 'p');
  });
});
