import { ErrorSql, MAX_LARGO_SQL, validarSql } from './validar-sql';

describe('validarSql', () => {
  it('acepta SELECT y WITH, y quita el ";" final', () => {
    expect(validarSql('  SELECT * FROM recintos;  ')).toBe('SELECT * FROM recintos');
    expect(validarSql('with c as (select 1) select * from c')).toBe('with c as (select 1) select * from c');
  });

  it('dentro de un texto entre comillas puede haber ";", "--" o palabras prohibidas', () => {
    const sql = "SELECT * FROM recintos WHERE nombre LIKE '%delete; -- drop%' OR nombre = 'O''Higgins'";
    expect(validarSql(sql)).toBe(sql);
  });

  it('permite funciones de texto como replace()', () => {
    expect(() => validarSql("SELECT replace(nombre, 'UE ', '') FROM recintos")).not.toThrow();
  });

  it.each([
    ['', 'vacía'],
    ['   ;  ', 'vacía'],
    ['SELECT 1; SELECT 2', 'una consulta'],
    ['SELECT 1; DROP TABLE recintos', 'una consulta'],
    ['SELECT 1 -- comentario', 'comentarios'],
    ['SELECT /* x */ 1', 'comentarios'],
    ['DELETE FROM recintos', 'SELECT'],
    ['PRAGMA query_only = 0', 'SELECT'],
    ["ATTACH DATABASE 'x' AS y", 'SELECT'],
    ['WITH x AS (DELETE FROM recintos) SELECT 1', 'DELETE'],
    ["SELECT load_extension('evil')", 'LOAD_EXTENSION'],
    ['SELECT 1 FROM recintos WHERE pragma = 1', 'PRAGMA'],
    ["SELECT 'abierta", 'comilla'],
  ])('rechaza %j (%s)', (sql, motivo) => {
    expect(() => validarSql(sql)).toThrow(ErrorSql);
    expect(() => validarSql(sql)).toThrow(new RegExp(motivo, 'i'));
  });

  it('rechaza lo que no es texto y las consultas demasiado largas', () => {
    expect(() => validarSql(42)).toThrow(ErrorSql);
    expect(() => validarSql(null)).toThrow(ErrorSql);
    expect(() => validarSql(`SELECT '${'x'.repeat(MAX_LARGO_SQL)}'`)).toThrow(/caracteres/);
  });
});
