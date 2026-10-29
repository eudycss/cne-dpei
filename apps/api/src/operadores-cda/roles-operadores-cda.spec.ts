import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/roles.decorator';
import { AsistenciaCdaController } from './asistencia-cda.controller';
import { OperadoresCdaController } from './operadores-cda.controller';
import { FotoCdaController, FotoCdaPublicoController } from './foto-cda.controller';
import { ActasCdaController } from './actas-cda.controller';
import { AtrasosCdaController } from './atrasos-cda.controller';
import { CredencialQrCdaController } from './credencial-qr-cda.controller';
import { IS_PUBLIC_KEY } from '../common/jwt-auth.guard';
import { MODULO_KEY, ModuloGuard } from '../permisos-modulos/modulo.guard';
import { ParejasCdaController, parsearFecha } from './parejas-cda.controller';

// Lo mismo que resuelve RolesGuard: primero el método, luego la clase.
const rolesDe = (controlador: any, metodo: string) =>
  new Reflector().getAllAndOverride<string[]>(ROLES_KEY, [controlador.prototype[metodo], controlador]);

const TOMAN_ASISTENCIA = ['ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL'];

describe('RBAC de Operadores CDA', () => {
  it.each(['dia', 'exportar', 'masiva', 'marcar', 'deshacer'])(
    'asistencia.%s: solo administrador, técnico supervisor y asistente transversal (no LECTOR ni OPERADOR_CDA)',
    (metodo) => {
      expect(rolesDe(AsistenciaCdaController, metodo)).toEqual(TOMAN_ASISTENCIA);
    },
  );

  it('ver el listado: los mismos tres roles; importar el Excel: solo administrador', () => {
    expect(rolesDe(OperadoresCdaController, 'list')).toEqual(TOMAN_ASISTENCIA);
    expect(rolesDe(OperadoresCdaController, 'importar')).toEqual(['ADMINISTRADOR']);
  });

  it('buscar en todos los cargos: los mismos tres roles; ocultos solo para el administrador', () => {
    expect(rolesDe(OperadoresCdaController, 'buscar')).toEqual(TOMAN_ASISTENCIA);
    const buscar = jest.fn();
    const ctrl = new OperadoresCdaController({ buscar } as never);
    ctrl.buscar({ roles: ['TECNICO_SUPERVISOR'] } as never, ' 1005201015 ', 'true');
    ctrl.buscar({ roles: ['ADMINISTRADOR'] } as never, 'pérez', 'true');
    expect(buscar.mock.calls.map(([o]) => o)).toEqual([
      { q: '1005201015', incluirInactivos: false },
      { q: 'pérez', incluirInactivos: true },
    ]);
  });

  it.each(['listar', 'fechas', 'qr'])('parejas.%s: los mismos tres roles y el módulo operadores-cda', (metodo) => {
    expect(rolesDe(ParejasCdaController, metodo)).toEqual(TOMAN_ASISTENCIA);
    expect(Reflect.getMetadata(MODULO_KEY, (ParejasCdaController.prototype as any)[metodo])).toBe('operadores-cda');
  });

  it.each(['disponibles', 'plantilla', 'crear', 'editar', 'eliminar', 'aplicar', 'importar'])(
    'parejas.%s: solo administrador',
    (metodo) => {
      expect(rolesDe(ParejasCdaController, metodo)).toEqual(['ADMINISTRADOR']);
    },
  );

  it('parejas.importar: ?app=false guarda sin pasar a la app', () => {
    const importar = jest.fn();
    const ctrl = new ParejasCdaController({ importar } as never);
    const file = {} as Express.Multer.File;
    ctrl.importar(file, { sub: 'admin' } as never, '2026-10-28', 'true', 'false');
    ctrl.importar(file, { sub: 'admin' } as never, '2026-10-30', 'true');
    expect(importar.mock.calls.map((c) => c.slice(1, 5))).toEqual([
      ['2026-10-28', true, 'admin', false],
      ['2026-10-30', true, 'admin', true],
    ]);
  });

  it('parejas: ?fecha= obligatoria y válida', () => {
    expect(parsearFecha('2026-10-30')).toBe('2026-10-30');
    for (const f of [undefined, '', '30/10/2026', ['2026-10-30', '2026-10-31']]) {
      expect(() => parsearFecha(f)).toThrow(BadRequestException);
    }
  });

  it('buscar exige el módulo operadores-cda, igual que el listado', () => {
    for (const metodo of ['list', 'buscar']) {
      const fn = (OperadoresCdaController.prototype as any)[metodo];
      expect(Reflect.getMetadata(MODULO_KEY, fn)).toBe('operadores-cda');
      expect(Reflect.getMetadata('__guards__', fn)).toContain(ModuloGuard);
    }
  });

  it('buscar: 400 con menos de 3 caracteres, vacío o repetido; acota el largo a 100', () => {
    const buscar = jest.fn();
    const ctrl = new OperadoresCdaController({ buscar } as never);
    const admin = { roles: ['ADMINISTRADOR'] } as never;
    for (const q of [undefined, '', '  ab  ', ['abc', 'def']]) {
      expect(() => ctrl.buscar(admin, q as never)).toThrow(BadRequestException);
    }
    expect(buscar).not.toHaveBeenCalled();
    ctrl.buscar(admin, 'x'.repeat(300));
    expect(buscar.mock.calls[0][0].q).toHaveLength(100);
  });

  it.each(['crear', 'editar', 'cambiarActivo', 'cambiarCargo'])('agregar, editar u ocultar (%s): solo administrador', (metodo) => {
    expect(rolesDe(OperadoresCdaController, metodo)).toEqual(['ADMINISTRADOR']);
  });

  it('ver los ocultos: solo administrador, aunque otro rol mande ?incluirInactivos=true', () => {
    const list = jest.fn();
    const ctrl = new OperadoresCdaController({ list } as never);
    ctrl.list({ roles: ['TECNICO_SUPERVISOR'] } as never, undefined, 'true');
    ctrl.list({ roles: ['ADMINISTRADOR'] } as never, undefined, 'true');
    expect(list.mock.calls.map(([o]) => o.incluirInactivos)).toEqual([false, true]);
  });

  it.each(['crearEnlace', 'foto'])('foto.%s: los mismos tres roles', (metodo) => {
    expect(rolesDe(FotoCdaController, metodo)).toEqual(TOMAN_ASISTENCIA);
  });

  it.each(['lista', 'personasEntrega', 'generar', 'zip', 'word', 'pdf', 'firmar'])(
    'actas.%s: los mismos tres roles',
    (metodo) => {
      expect(rolesDe(ActasCdaController, metodo)).toEqual(TOMAN_ASISTENCIA);
    },
  );

  it.each(['config', 'reporte', 'exportar'])('atrasos.%s: los mismos tres roles', (metodo) => {
    expect(rolesDe(AtrasosCdaController, metodo)).toEqual(TOMAN_ASISTENCIA);
  });

  it.each(['consultar', 'marcar'])('escanear carnet (%s): los mismos tres roles', (metodo) => {
    expect(rolesDe(CredencialQrCdaController, metodo)).toEqual(TOMAN_ASISTENCIA);
  });

  // El techo es el de asistencia; quién puede de verdad lo decide la acción
  // 'cda.carnets.emitir' (de fábrica solo el administrador, ver permiso.guard.spec).
  it.each(['carnets', 'revocar'])('emitir o anular carnets (%s): techo de asistencia + acción', (metodo) => {
    expect(rolesDe(CredencialQrCdaController, metodo)).toEqual(TOMAN_ASISTENCIA);
    expect(Reflect.getMetadata('permisoAccion', (CredencialQrCdaController.prototype as any)[metodo])).toEqual([
      'cda.carnets.emitir',
    ]);
  });

  it.each([
    ['vigentes', ['cda.carnets.emitir', 'cda.carnets.reimprimir']],
    ['reimprimir', ['cda.carnets.reimprimir']],
  ])('ver o reimprimir carnets (%s): techo de asistencia + acción', (metodo, acciones) => {
    expect(rolesDe(CredencialQrCdaController, metodo)).toEqual(TOMAN_ASISTENCIA);
    expect(Reflect.getMetadata('permisoAccion', (CredencialQrCdaController.prototype as any)[metodo])).toEqual(acciones);
  });

  it('cambiar la hora oficial de entrada: solo administrador', () => {
    expect(rolesDe(AtrasosCdaController, 'guardarConfig')).toEqual(['ADMINISTRADOR']);
  });

  it('reabrir un acta firmada: solo administrador', () => {
    expect(rolesDe(ActasCdaController, 'reabrir')).toEqual(['ADMINISTRADOR']);
  });

  it('la página del enlace es pública (sin sesión) y no expone rutas con roles', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FotoCdaPublicoController)).toBe(true);
    expect(rolesDe(FotoCdaPublicoController, 'subir')).toBeUndefined();
  });
});
