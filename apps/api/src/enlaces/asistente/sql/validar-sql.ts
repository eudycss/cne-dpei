/**
 * Primera barrera para el SQL que escribe el modelo: una sola consulta de lectura.
 * No es la única: la consulta corre en una base SQLite en memoria (copia desechable,
 * sin teléfonos), con query_only, en un hilo aparte con tiempo y memoria limitados.
 */

/** Error que se le puede devolver al modelo para que corrija su consulta (sin datos). */
export class ErrorSql extends Error {}

export const MAX_LARGO_SQL = 1500;

/** Palabras que no tienen nada que hacer en una consulta de lectura. */
const PROHIBIDAS =
  /\b(attach|detach|pragma|insert|update|delete|drop|create|alter|vacuum|reindex|analyze|trigger|begin|commit|rollback|savepoint|release|load_extension)\b/i;

/** Devuelve el SQL listo para ejecutar o lanza ErrorSql con el motivo. */
export function validarSql(sql: unknown): string {
  if (typeof sql !== 'string') throw new ErrorSql('La consulta debe ser texto.');
  const limpia = sql.trim().replace(/;\s*$/, '').trim();
  if (!limpia) throw new ErrorSql('La consulta está vacía.');
  if (limpia.length > MAX_LARGO_SQL) throw new ErrorSql(`La consulta pasa de ${MAX_LARGO_SQL} caracteres.`);

  // Lo que está entre comillas simples es texto: ahí sí puede haber ";" o "delete".
  const sinTextos = limpia.replace(/'(?:[^']|'')*'/g, ' texto ');
  if (sinTextos.includes("'")) throw new ErrorSql('Hay una comilla sin cerrar.');
  if (sinTextos.includes(';')) throw new ErrorSql('Solo se permite una consulta.');
  if (sinTextos.includes('--') || sinTextos.includes('/*')) throw new ErrorSql('No se permiten comentarios.');
  if (!/^(select|with)\b/i.test(sinTextos)) throw new ErrorSql('Solo se permiten consultas SELECT.');
  const prohibida = sinTextos.match(PROHIBIDAS);
  if (prohibida) throw new ErrorSql(`No se permite ${prohibida[1].toUpperCase()}.`);
  return limpia;
}
