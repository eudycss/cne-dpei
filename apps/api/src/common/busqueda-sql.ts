import { Prisma } from '@prisma/client';
import { palabrasBusqueda } from '@cne/shared-validation';

/**
 * Búsqueda en SQL con la misma regla que la web (coincideBusqueda de
 * @cne/shared-validation): sin distinguir mayúsculas ni tildes ("ñ" = "n") y
 * por palabras en cualquier orden. Prisma no tiene un "contains sin tildes",
 * así que se arma la condición a mano.
 *
 * `translate` es nativo de PostgreSQL (no requiere la extensión unaccent ni
 * migración). Incluye también las mayúsculas con tilde: así no depende de que
 * `lower('Á')` dé 'á', que varía con el LC_CTYPE de la base.
 */
const CON_TILDE = 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
const SIN_TILDE = 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc';

/** Topes de lo que se escribe en un buscador: cada palabra es un LIKE más. */
export const MAX_CARACTERES_BUSQUEDA = 100;
export const MAX_PALABRAS_BUSQUEDA = 8;

/** `%` y `_` escritos por el usuario se buscan literalmente (\ es el escape por defecto de LIKE). */
function escaparLike(palabra: string): string {
  return palabra.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Condición SQL: cada palabra de la consulta aparece en alguno de los campos.
 * Los campos son columnas fijas del código (Prisma.raw); lo escrito por el
 * usuario va siempre como parámetro. null si no hay nada que buscar (vacío,
 * o un valor que no es texto, p. ej. `?search=a&search=b` llega como arreglo).
 */
export function condicionBusqueda(campos: Prisma.Sql[], consulta: unknown): Prisma.Sql | null {
  if (typeof consulta !== 'string') return null;
  const palabras = palabrasBusqueda(consulta.slice(0, MAX_CARACTERES_BUSQUEDA)).slice(0, MAX_PALABRAS_BUSQUEDA);
  if (palabras.length === 0) return null;
  const texto = Prisma.sql`translate(lower(concat_ws(' ', ${Prisma.join(campos)})), ${CON_TILDE}, ${SIN_TILDE})`;
  return Prisma.join(
    palabras.map((p) => Prisma.sql`${texto} LIKE ${`%${escaparLike(p)}%`}`),
    ' AND ',
  );
}

type ConsultaRaw = { $queryRaw<T = unknown>(query: Prisma.Sql): Prisma.PrismaPromise<T> };

/**
 * Ids que cumplen la búsqueda, para combinarlos con el resto del filtro de
 * Prisma (`where.id = { in: ids }`). `desde` es el FROM con sus JOIN, fijo en
 * el código, y debe exponer la tabla principal como alias `t`. `acotar` es un
 * filtro extra (p. ej. el evento) para no traer ids de más. undefined si no
 * hay nada que buscar (no se filtra).
 */
export async function idsPorBusqueda(
  prisma: ConsultaRaw,
  desde: Prisma.Sql,
  campos: Prisma.Sql[],
  consulta: unknown,
  acotar?: Prisma.Sql,
): Promise<string[] | undefined> {
  const condicion = condicionBusqueda(campos, consulta);
  if (!condicion) return undefined;
  const donde = acotar ? Prisma.sql`(${acotar}) AND ${condicion}` : condicion;
  const filas = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT t.id FROM ${desde} WHERE ${donde}`);
  return filas.map((f) => f.id);
}
