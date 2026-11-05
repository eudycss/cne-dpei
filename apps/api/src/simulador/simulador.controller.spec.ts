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

describe('SimuladorController: descargas del reporte', () => {
  const OP = '22222222-2222-4222-8222-222222222222';
  const PR = '11111111-1111-4111-8111-111111111111';
  const fila = { operadorId: OP, cedula: '1710034065', apellidosNombres: 'ANA', telefono: null, cargo: 'D', estado: 'NO_SE_PRESENTO', asignada: true, intentos: [], mejor: null, cumplio: false };
  const rep = {
    practica: { id: PR, nombre: 'P', metaActas: 1, plazoMinutos: 1, filasPorActa: 1, inicio: '2026-11-10T13:00:00Z', fin: '2026-11-10T18:00:00Z' },
    generadoEn: '2026-11-10T13:00:00Z',
    totales: { personas: 1, presentaron: 0, cumplieron: 0, enCurso: 0, noSePresentaron: 1 },
    filas: [fila],
  };
  const res = () => ({ setHeader: jest.fn(), send: jest.fn() });

  it('Excel general y PDF individual, sin caché', async () => {
    const practicas = { reporte: jest.fn().mockResolvedValue(rep) };
    const ctrl = new SimuladorController(practicas as never);
    const r1 = res();
    await ctrl.exportarExcel(r1 as never, PR);
    expect(r1.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="simulador_digitacion_2026-11-10_2026-11-10.xlsx"');
    expect(r1.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    const r2 = res();
    await ctrl.exportarPdf(r2 as never, PR, OP);
    expect(r2.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="simulador_digitacion_1710034065_2026-11-10_2026-11-10.pdf"');
  });

  it.each([['no-uuid'], [[OP, OP]]])('operadorId inválido (%p): 400 sin consultar', async (op) => {
    const practicas = { reporte: jest.fn() };
    const ctrl = new SimuladorController(practicas as never);
    await expect(ctrl.exportarExcel(res() as never, PR, op)).rejects.toMatchObject({ status: 400 });
    expect(practicas.reporte).not.toHaveBeenCalled();
  });

  it('operadorId vacío = reporte general', async () => {
    const practicas = { reporte: jest.fn().mockResolvedValue(rep) };
    const r = res();
    await new SimuladorController(practicas as never).exportarExcel(r as never, PR, '');
    expect(r.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="simulador_digitacion_2026-11-10_2026-11-10.xlsx"');
  });

  it('el reporte en pantalla: sin caché y con límite por IP', () => {
    const fn = metodo(SimuladorController.prototype, 'reporte');
    expect(Reflect.getMetadata('__headers__', fn)).toEqual([{ name: 'Cache-Control', value: 'no-store' }]);
    const clave = Reflect.getMetadataKeys(fn).find((k) => String(k).includes('LIMIT') && String(k).includes('default'));
    expect(Reflect.getMetadata(clave, fn)).toBe(120);
  });

  it('persona que no está en la práctica: 404', async () => {
    const ctrl = new SimuladorController({ reporte: jest.fn().mockResolvedValue(rep) } as never);
    await expect(ctrl.exportarPdf(res() as never, PR, '33333333-3333-4333-8333-333333333333')).rejects.toMatchObject({ status: 404 });
  });

  it('las descargas tienen límite por IP', () => {
    for (const m of ['exportarExcel', 'exportarPdf']) {
      const fn = metodo(SimuladorController.prototype, m);
      const clave = Reflect.getMetadataKeys(fn).find((k) => String(k).includes('LIMIT') && String(k).includes('default'));
      expect(Reflect.getMetadata(clave, fn)).toBe(30);
    }
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
