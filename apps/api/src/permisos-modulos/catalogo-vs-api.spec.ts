import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Reflector } from '@nestjs/core';
import { MODULOS_WEB, type ModuloWebId } from '@cne/shared-validation';
import { LECTURA_CONFIGURABLE_KEY, ROLES_KEY } from '../common/roles.decorator';
import { MODULO_KEY } from './modulo.guard';
import { UsersController } from '../users/users.controller';
import { CatalogController } from '../catalog/catalog.controller';
import { MilitaresController } from '../militares/militares.controller';
import { EventosController } from '../eventos/eventos.controller';
import { AsignacionesController } from '../asignaciones/asignaciones.controller';
import { KitsController } from '../kits/kits.controller';
import { TrackingController } from '../tracking/tracking.controller';
import { IncidenciasController } from '../incidencias/incidencias.controller';
import { AlertasController } from '../alertas/alertas.controller';
import { OperadoresCdaController } from '../operadores-cda/operadores-cda.controller';
import { CustodiaController } from '../custodia/custodia.controller';
import { SimuladorController } from '../simulador/simulador.controller';

// Lo mismo que resuelve RolesGuard: primero el método, luego la clase.
const rolesDe = (controlador: any, metodo: string) =>
  new Reflector().getAllAndOverride<string[]>(ROLES_KEY, [controlador.prototype[metodo], controlador]);

/**
 * El endpoint principal que carga cada módulo. Es un Record: un módulo nuevo en
 * el catálogo no compila hasta decir de dónde lee (null = no usa el API).
 */
const ENDPOINT: Record<ModuloWebId, [controlador: unknown, metodo: string] | null> = {
  inicio: [EventosController, 'active'],
  recintos: [CatalogController, 'listRecintos'],
  usuarios: [UsersController, 'list'],
  militares: [MilitaresController, 'list'],
  eventos: [EventosController, 'list'],
  asignaciones: [AsignacionesController, 'list'],
  kits: [KitsController, 'list'],
  monitoreo: [TrackingController, 'estadoCdas'],
  incidencias: [IncidenciasController, 'list'],
  alertas: [AlertasController, 'list'],
  'operadores-cda': [OperadoresCdaController, 'list'],
  'simulador-digitacion': [SimuladorController, 'listar'],
  'cadena-custodia': [CustodiaController, 'informe'],
  reportes: [TrackingController, 'reporteNoCda'],
  // Power BI controla su propio acceso: no consume el API.
  'powerbi-cdas': null,
};

describe('Catálogo de módulos web vs. API', () => {
  it.each(MODULOS_WEB.filter((m) => ENDPOINT[m.id]).map((m) => [m.id, m] as const))(
    '%s: el API deja entrar a los roles configurables por el alias del administrador',
    (_id, modulo) => {
      const [controlador, metodo] = ENDPOINT[modulo.id]!;
      const roles = rolesDe(controlador, metodo);
      expect(roles).toBeDefined();
      // Sin techo: los roles configurables sin @Roles propio entran por el alias del
      // administrador (RolesGuard), así que el endpoint debe nombrarlo...
      expect(roles).toContain('ADMINISTRADOR');
      // Los roles que no son analista solo leen lo marcado @LecturaConfigurable (lista blanca).
      expect(new Reflector().getAllAndOverride<boolean>(LECTURA_CONFIGURABLE_KEY, [(controlador as any).prototype[metodo], controlador as any])).toBe(true);
      // ...y declarar su módulo (si no, el alias cierra el paso).
      // 'inicio' lee el evento activo, que declara el módulo 'eventos'.
      if (modulo.id !== 'inicio') {
        const declarado = new Reflector().getAllAndOverride<string>(MODULO_KEY, [(controlador as any).prototype[metodo], controlador as any]);
        expect(declarado).toBe(modulo.id);
      }
    },
  );

  it('la migración precarga exactamente la visibilidad de fábrica del catálogo', () => {
    const dir = join(__dirname, '../../prisma/migrations');
    // La de fábrica de entonces, más lo que se agregó después (cada cosa en su migración).
    const sql = readdirSync(dir)
      .map((d) => join(dir, d, 'migration.sql'))
      .filter((f) => existsSync(f))
      .map((f) => readFileSync(f, 'utf8'))
      .filter((s) => s.includes('INSERT INTO "rol_modulos"'))
      .join(' ');
    const delSql = [...sql.matchAll(/\('([A-Z_]+)',\s*'([a-z-]+)'\)/g)].map(([, rol, mod]) => `${rol}:${mod}`).sort();
    const deFabrica = MODULOS_WEB.flatMap((m) => m.rolesPorDefecto.map((rol) => `${rol}:${m.id}`)).sort();
    expect(delSql).toEqual(deFabrica);
  });
});
