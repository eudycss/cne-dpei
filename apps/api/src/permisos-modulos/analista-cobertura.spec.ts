import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, SOLO_ADMIN_KEY } from '../common/roles.decorator';
import { MODULO_KEY } from './modulo.guard';
import { PERMISO_KEY } from './permiso.guard';

/** Todos los *.controller.ts de src/ (sin specs). */
function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) return controllers(f);
    return n.endsWith('.controller.ts') ? [f] : [];
  });
}

/**
 * RolesGuard deja entrar al ANALISTA_PROVINCIAL solo donde entra el administrador Y el
 * endpoint declara su módulo o su acción. Si alguien agrega un endpoint de administrador
 * sin declararlo, el analista quedaría con un 403 silencioso: este barrido lo avisa.
 */
describe('Cobertura del analista provincial en los endpoints de administrador', () => {
  const reflector = new Reflector();
  const sinDeclarar: string[] = [];
  for (const archivo of controllers(join(__dirname, '..'))) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(archivo);
    for (const clase of Object.values<any>(mod).filter((v) => typeof v === 'function')) {
      for (const nombre of Object.getOwnPropertyNames(clase.prototype)) {
        const handler = clase.prototype[nombre];
        if (nombre === 'constructor' || typeof handler !== 'function') continue;
        const destino = [handler, clase];
        const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, destino);
        if (!roles?.includes('ADMINISTRADOR')) continue;
        if (reflector.getAllAndOverride<boolean>(SOLO_ADMIN_KEY, destino)) continue;
        const declara = reflector.getAllAndOverride(MODULO_KEY, destino) || reflector.getAllAndOverride(PERMISO_KEY, destino);
        if (!declara) sinDeclarar.push(`${clase.name}.${nombre}`);
      }
    }
  }

  it('cada handler de administrador declara módulo o acción, o es @SoloAdmin', () => {
    expect(sinDeclarar).toEqual([]);
  });
  it('el barrido encontró controllers', () => {
    expect(controllers(join(__dirname, '..')).length).toBeGreaterThan(20);
  });
});
