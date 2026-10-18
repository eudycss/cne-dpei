import { ejecutarSql, MAX_SQL_EN_COLA, MotorSqlNoDisponible, type FilaSql } from './motor-sql';
import { ErrorSql } from './validar-sql';

const fila = (codigo: string, canton: string, estado: 'caido' | 'activo', tecnico: string | null, tieneContacto: 0 | 1 = 1): FilaSql => ({
  codigo,
  nombre: `Escuela ${codigo}`,
  canton,
  parroquia: null,
  estado,
  numero_tecnico: tecnico ? 1 : null,
  tecnico,
  tiene_contacto: tieneContacto,
});

const FILAS: FilaSql[] = [
  fila('1', 'Ibarra', 'caido', 'Jairo'),
  fila('2', 'Ibarra', 'activo', 'Jairo'),
  fila('3', 'Ibarra', 'activo', null, 0),
  fila('4', 'Urcuquí', 'caido', 'Willy'),
  fila('5', 'Cotacachi', 'activo', 'Willy'),
  fila('6', 'Ibarra', 'activo', 'Jairo'),
];

jest.setTimeout(20_000);

describe('ejecutarSql', () => {
  it('consulta la tabla recintos y devuelve columnas y filas', async () => {
    const r = await ejecutarSql(
      "SELECT canton, count(*) AS total, sum(estado = 'caido') AS caidos FROM recintos GROUP BY canton ORDER BY total DESC, canton",
      FILAS,
    );
    expect(r).toEqual({
      columnas: ['canton', 'total', 'caidos'],
      filas: [
        ['Ibarra', 4, 1],
        ['Cotacachi', 1, 0],
        ['Urcuquí', 1, 1],
      ],
      hayMas: false,
    });
  });

  it('"5 al azar": ORDER BY random() LIMIT', async () => {
    const r = await ejecutarSql("SELECT codigo FROM recintos WHERE canton = 'Ibarra' ORDER BY random() LIMIT 3", FILAS);
    expect(r.filas).toHaveLength(3);
    r.filas.forEach(([c]) => expect(['1', '2', '3', '6']).toContain(c));
  });

  it('norm() compara sin tildes ni mayúsculas', async () => {
    const r = await ejecutarSql("SELECT codigo FROM recintos WHERE norm(canton) = norm('URCUQUI')", FILAS);
    expect(r.filas).toEqual([['4']]);
  });

  it('la tabla no tiene teléfonos ni encargados', async () => {
    const r = await ejecutarSql('SELECT * FROM recintos LIMIT 1', FILAS);
    expect(r.columnas).toEqual(['codigo', 'nombre', 'canton', 'parroquia', 'estado', 'numero_tecnico', 'tecnico', 'tiene_contacto']);
  });

  it('corta en el máximo de filas y avisa que hay más', async () => {
    const r = await ejecutarSql('SELECT a.codigo, b.codigo FROM recintos a, recintos b', FILAS, { maxFilas: 10 });
    expect(r.filas).toHaveLength(10);
    expect(r.hayMas).toBe(true);
  });

  it('un error de SQL vuelve como ErrorSql con el mensaje de SQLite (para que el modelo corrija)', async () => {
    await expect(ejecutarSql('SELECT telefono FROM recintos', FILAS)).rejects.toThrow(/SQLite: no such column: telefono/);
    await expect(ejecutarSql('SELECT * FROM usuarios', FILAS)).rejects.toThrow(ErrorSql);
  });

  it('recorta textos largos y no devuelve binarios', async () => {
    const r = await ejecutarSql("SELECT printf('%.1000c', 'x') AS largo, zeroblob(4) AS bin", FILAS);
    expect(r.filas[0][0]).toHaveLength(300);
    expect(r.filas[0][1]).toBe('[binario]');
  });

  it('las funciones pragma_* no pueden relajar los límites', async () => {
    await expect(ejecutarSql('SELECT * FROM pragma_query_only(0)', FILAS)).rejects.toThrow(ErrorSql);
  });

  it('una consulta a la vez: las demás esperan su turno y todas responden', async () => {
    const consultas = [1, 2, 3].map((n) => ejecutarSql(`SELECT ${n} AS n`, FILAS));
    const resultados = await Promise.all(consultas);
    expect(resultados.map((r) => r.filas[0][0])).toEqual([1, 2, 3]);
  });

  it('con la cola llena, rechaza en vez de acumular hilos', async () => {
    const lenta = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c';
    const enCurso = Array.from({ length: 1 + MAX_SQL_EN_COLA }, () =>
      ejecutarSql(lenta, FILAS, { tiempoMaxMs: 300 }).catch((e) => e),
    );
    await expect(ejecutarSql('SELECT 1', FILAS)).rejects.toThrow(MotorSqlNoDisponible);
    const errores = await Promise.all(enCurso);
    errores.forEach((e) => expect(e).toBeInstanceOf(ErrorSql));
    // Al vaciarse la cola, se vuelve a poder consultar.
    await expect(ejecutarSql('SELECT 1 AS n', FILAS)).resolves.toMatchObject({ filas: [[1]] });
  });

  it('una consulta prohibida no llega a ejecutarse', async () => {
    await expect(ejecutarSql('DELETE FROM recintos', FILAS)).rejects.toThrow(ErrorSql);
  });

  it('una consulta infinita se corta por tiempo sin frenar el resto del proceso', async () => {
    const infinita = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c';
    const inicio = Date.now();
    let demoraTimer = -1;
    const timer = new Promise<void>((ok) =>
      setTimeout(() => {
        demoraTimer = Date.now() - inicio;
        ok();
      }, 50),
    );
    await expect(ejecutarSql(infinita, FILAS, { tiempoMaxMs: 800 })).rejects.toThrow(/tardó más de 0.8 s/);
    await timer;
    // El hilo principal siguió libre: el temporizador de 50 ms no esperó a la consulta.
    expect(demoraTimer).toBeLessThan(500);
    expect(Date.now() - inicio).toBeLessThan(5_000);
  });

  it('una consulta que pide mucha memoria falla en vez de tumbar el proceso', async () => {
    const pesada =
      'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c LIMIT 5000000) ' +
      "SELECT x, printf('%.200c', 'x') AS relleno FROM c ORDER BY relleno, x DESC";
    // Falla por el límite de memoria de SQLite, mucho antes del tiempo máximo.
    await expect(ejecutarSql(pesada, FILAS, { tiempoMaxMs: 10_000 })).rejects.toThrow(/SQLite: out of memory/);
  });
});
