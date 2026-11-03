import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { idsPorBusqueda } from '../src/common/busqueda-sql';

/**
 * El SQL de búsqueda (translate + LIKE por palabra) contra PostgreSQL real:
 * los tests unitarios solo ven el texto armado, no si la base lo ejecuta y
 * encuentra lo esperado. Requiere postgres levantado (pnpm db:up) y el cargo
 * OPERADOR sembrado (pnpm db:seed).
 */
describe('búsqueda sin tildes y por palabras (PostgreSQL real)', () => {
  const prisma = new PrismaClient();
  // Cédulas de prueba que no chocan con datos reales ni entre corridas.
  const sufijo = String(Date.now()).slice(-6);
  const personas = [
    { clave: 'perez', apellidosNombres: 'PÉREZ GÓMEZ JUAN CARLOS', cedula: `91${sufijo}01` },
    { clave: 'munoz', apellidosNombres: 'MUÑOZ ANDRADE MARÍA', cedula: `91${sufijo}02` },
    { clave: 'raro', apellidosNombres: 'CIEN_POR%CIENTO PRUEBA', cedula: `91${sufijo}03` },
  ];
  const ids: Record<string, string> = {};
  const DESDE = Prisma.sql`operadores_cda t`;
  const CAMPOS = [Prisma.raw('t.apellidos_nombres'), Prisma.raw('t.cedula')];

  async function buscar(consulta: string): Promise<string[]> {
    const encontrados = (await idsPorBusqueda(prisma, DESDE, CAMPOS, consulta)) ?? [];
    // Solo nuestras filas: la base local puede tener otros operadores.
    return Object.entries(ids)
      .filter(([, id]) => encontrados.includes(id))
      .map(([clave]) => clave);
  }

  beforeAll(async () => {
    for (const p of personas) {
      const fila = await prisma.operadorCda.create({
        data: { apellidosNombres: p.apellidosNombres, cedula: p.cedula, cargo: 'OPERADOR CDA (prueba e2e)' },
      });
      ids[p.clave] = fila.id;
    }
  });

  afterAll(async () => {
    await prisma.operadorCda.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  it.each([
    ['juan perez', 'nombre y apellido en otro orden, sin tilde'],
    ['Pérez Juan', 'saltando el segundo apellido'],
    ['PEREZ GOM', 'parte de una palabra'],
    ['gomez carlos', 'segundo apellido y segundo nombre'],
    [`${personas[0].cedula.slice(0, 8)} juan`, 'parte de la cédula junto con el nombre'],
  ])('"%s" encuentra a PÉREZ GÓMEZ JUAN CARLOS (%s)', async (consulta) => {
    expect(await buscar(consulta)).toContain('perez');
  });

  it('"munoz maria" encuentra a MUÑOZ ANDRADE MARÍA y "muñoz" también', async () => {
    expect(await buscar('munoz maria')).toEqual(['munoz']);
    expect(await buscar('MUÑOZ')).toEqual(['munoz']);
  });

  it('exige todas las palabras', async () => {
    expect(await buscar('juan andrade')).toEqual([]);
  });

  it('% y _ se buscan literalmente, no como comodines', async () => {
    expect(await buscar('cien_por%')).toEqual(['raro']);
    // "_" literal: "cienxpor" no debe coincidir con "cien_por".
    expect(await buscar('cienxpor')).toEqual([]);
    // "%" solo no es comodín de "todo".
    expect(await buscar('%')).toEqual(['raro']);
  });

  it('un intento de inyección se busca como texto y no rompe la consulta', async () => {
    expect(await buscar("'; DROP TABLE operadores_cda; --")).toEqual([]);
    expect(await prisma.operadorCda.count({ where: { id: { in: Object.values(ids) } } })).toBe(3);
  });
});
