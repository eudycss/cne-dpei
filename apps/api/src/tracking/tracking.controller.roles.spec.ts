import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/roles.decorator';
import { TrackingController } from './tracking.controller';

// Fija qué roles pueden usar cada endpoint de la verificación de retorno: el
// RolesGuard confía en estos metadatos, así que un cambio aquí es un cambio de
// permisos y debe romper un test.
const rolesDe = (metodo: keyof TrackingController): string[] =>
  new Reflector().get(ROLES_KEY, TrackingController.prototype[metodo] as () => unknown);

describe('TrackingController — roles de la verificación de kits al retorno', () => {
  it('solo el asistente transversal y el admin validan y verifican kits (ya no el técnico supervisor)', () => {
    for (const metodo of ['validarKitRetorno', 'verificarKitRetorno'] as const) {
      expect(rolesDe(metodo)).toEqual(['ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR']);
    }
  });

  it('la lista de kits verificados la leen el asistente, el supervisor, el admin y el lector', () => {
    expect(rolesDe('kitsVerificadosRetorno')).toEqual([
      'ASISTENTE_TRANSVERSAL',
      'TECNICO_SUPERVISOR',
      'ADMINISTRADOR',
      'LECTOR',
    ]);
  });
});
