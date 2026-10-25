import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/roles.decorator';
import { AsistenciaCdaController } from './asistencia-cda.controller';
import { OperadoresCdaController } from './operadores-cda.controller';
import { FotoCdaController, FotoCdaPublicoController } from './foto-cda.controller';
import { ActasCdaController } from './actas-cda.controller';
import { AtrasosCdaController } from './atrasos-cda.controller';
import { CredencialQrCdaController } from './credencial-qr-cda.controller';
import { IS_PUBLIC_KEY } from '../common/jwt-auth.guard';

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

  it.each(['crear', 'editar', 'cambiarActivo'])('agregar, editar u ocultar (%s): solo administrador', (metodo) => {
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
  it.each(['vigentes', 'carnets', 'revocar'])('emitir, ver o anular carnets (%s): techo de asistencia + acción', (metodo) => {
    expect(rolesDe(CredencialQrCdaController, metodo)).toEqual(TOMAN_ASISTENCIA);
    expect(Reflect.getMetadata('permisoAccion', (CredencialQrCdaController.prototype as any)[metodo])).toEqual([
      'cda.carnets.emitir',
    ]);
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
