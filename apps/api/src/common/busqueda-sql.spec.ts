import { Prisma } from '@prisma/client';
import { MAX_CARACTERES_BUSQUEDA, MAX_PALABRAS_BUSQUEDA, condicionBusqueda, idsPorBusqueda } from './busqueda-sql';

const CAMPOS = [Prisma.raw('t.nombres'), Prisma.raw('t.apellidos')];

describe('condicionBusqueda', () => {
  it('una condición LIKE por palabra, unidas con AND, sobre los campos sin tildes', () => {
    const sql = condicionBusqueda(CAMPOS, 'Juan PÉREZ')!;

    expect(sql.sql).toBe(
      "translate(lower(concat_ws(' ', t.nombres,t.apellidos)), ?, ?) LIKE ? AND " +
        "translate(lower(concat_ws(' ', t.nombres,t.apellidos)), ?, ?) LIKE ?",
    );
    // Lo escrito por el usuario va como parámetro, ya normalizado (sin tilde, minúsculas).
    expect(sql.values.filter((v) => typeof v === 'string' && v.startsWith('%'))).toEqual(['%juan%', '%perez%']);
  });

  it('la tabla de traducción quita las tildes del español y la ñ', () => {
    const sql = condicionBusqueda(CAMPOS, 'x')!;
    const [con, sin] = sql.values as string[];
    expect(con).toHaveLength(sin.length);
    const mapa = Object.fromEntries([...con].map((c, i) => [c, sin[i]]));
    expect(mapa).toMatchObject({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n' });
    // También las mayúsculas: no depende de que lower('Á') dé 'á' (LC_CTYPE de la base).
    expect(mapa).toMatchObject({ Á: 'a', É: 'e', Í: 'i', Ó: 'o', Ú: 'u', Ü: 'u', Ñ: 'n' });
  });

  it('el texto del usuario nunca se inserta en el SQL (sin inyección)', () => {
    const sql = condicionBusqueda(CAMPOS, "'; DROP TABLE usuarios; --")!;

    expect(sql.sql).not.toContain('DROP');
    expect(sql.values).toContain("%';%");
  });

  it('% y _ escritos por el usuario se buscan literalmente', () => {
    const sql = condicionBusqueda(CAMPOS, '50%_a')!;

    expect(sql.values).toContain('%50\\%\\_a%');
  });

  it('sin palabras (vacío o solo espacios) no hay condición', () => {
    expect(condicionBusqueda(CAMPOS, '')).toBeNull();
    expect(condicionBusqueda(CAMPOS, '   ')).toBeNull();
  });

  it('un valor que no es texto (?search=a&search=b llega como arreglo) no busca ni revienta', () => {
    expect(condicionBusqueda(CAMPOS, ['a', 'b'])).toBeNull();
    expect(condicionBusqueda(CAMPOS, undefined)).toBeNull();
    expect(condicionBusqueda(CAMPOS, 42)).toBeNull();
  });

  it('tope de 8 palabras y 100 caracteres (cada palabra es un LIKE más)', () => {
    const muchas = condicionBusqueda(CAMPOS, Array.from({ length: 50 }, (_, i) => `p${i}`).join(' '))!;
    expect(muchas.sql.split(' LIKE ').length - 1).toBe(MAX_PALABRAS_BUSQUEDA);

    const larga = condicionBusqueda(CAMPOS, 'a'.repeat(5000))!;
    expect(larga.values).toContain(`%${'a'.repeat(MAX_CARACTERES_BUSQUEDA)}%`);
  });
});

describe('idsPorBusqueda', () => {
  it('sin búsqueda no consulta y devuelve undefined (no se filtra)', async () => {
    const prisma = { $queryRaw: jest.fn() };

    await expect(idsPorBusqueda(prisma as never, Prisma.sql`usuarios t`, CAMPOS, undefined)).resolves.toBeUndefined();
    await expect(idsPorBusqueda(prisma as never, Prisma.sql`usuarios t`, CAMPOS, '  ')).resolves.toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('devuelve los ids de las filas que coinciden', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) };

    await expect(idsPorBusqueda(prisma as never, Prisma.sql`usuarios t`, CAMPOS, 'juan')).resolves.toEqual(['a', 'b']);
    const consulta = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(consulta.sql).toMatch(/^SELECT t\.id FROM usuarios t WHERE translate/);
  });

  it('con un filtro extra (p. ej. el evento) lo antepone con AND', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };

    await idsPorBusqueda(prisma as never, Prisma.sql`kits_electorales t`, CAMPOS, 'kit', Prisma.sql`t.evento_id = ${'ev1'}::uuid`);

    const consulta = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(consulta.sql).toContain('WHERE (t.evento_id = ?::uuid) AND translate');
    expect(consulta.values[0]).toBe('ev1');
  });

  it('sin coincidencias devuelve [] (no undefined): el listado queda vacío', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };

    await expect(idsPorBusqueda(prisma as never, Prisma.sql`usuarios t`, CAMPOS, 'zzz')).resolves.toEqual([]);
  });
});
