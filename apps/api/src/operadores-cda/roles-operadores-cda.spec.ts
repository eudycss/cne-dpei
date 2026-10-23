import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/roles.decorator';
import { AsistenciaCdaController } from './asistencia-cda.controller';
import { OperadoresCdaController } from './operadores-cda.controller';

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
});
