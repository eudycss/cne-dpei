import { Worker } from 'node:worker_threads';
import { ErrorSql, validarSql } from './validar-sql';

/** Una fila de la tabla `recintos` que consulta el modelo. Sin teléfonos ni nombres de encargados. */
export interface FilaSql {
  codigo: string;
  nombre: string;
  canton: string | null;
  parroquia: string | null;
  estado: 'caido' | 'activo';
  numero_tecnico: number | null;
  tecnico: string | null;
  /** 1 si el recinto tiene encargado con teléfono registrado, 0 si no. */
  tiene_contacto: 0 | 1;
}

export type ValorSql = string | number | null;

export interface ResultadoSql {
  columnas: string[];
  filas: ValorSql[][];
  /** true si había más filas que el máximo y se cortó. */
  hayMas: boolean;
}

export interface OpcionesSql {
  maxFilas?: number;
  tiempoMaxMs?: number;
}

export const MAX_FILAS_SQL = 200;
export const TIEMPO_MAX_SQL_MS = 2_000;
/** Memoria máxima de SQLite dentro del hilo (un ORDER BY sobre millones de filas falla aquí). */
const MEMORIA_SQLITE = 32 * 1024 * 1024;
const MAX_LARGO_CELDA = 300;

const COLUMNAS = ['codigo', 'nombre', 'canton', 'parroquia', 'estado', 'numero_tecnico', 'tecnico', 'tiene_contacto'] as const;

/**
 * Código del hilo: arma la base en memoria, la deja de solo lectura y ejecuta la
 * consulta. Va como texto (eval) para no depender de cómo se compila o empaqueta
 * el proyecto; sql.js se carga por ruta absoluta.
 */
const CODIGO_HILO = `
const { parentPort, workerData: w } = require('node:worker_threads');
const responder = (m) => parentPort.postMessage(m);
const celda = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (v instanceof Uint8Array) return '[binario]';
  return String(v).slice(0, w.maxLargoCelda);
};
require(w.rutaSqlJs)().then((SQL) => {
  let db;
  try {
    db = new SQL.Database();
    // Con temp_store en memoria, los ordenamientos grandes también cuentan para el límite.
    db.run('PRAGMA temp_store = MEMORY');
    db.run('PRAGMA hard_heap_limit = ' + w.memoria);
    db.create_function('norm', (v) =>
      v === null || v === undefined ? null : String(v).normalize('NFD').replace(/\\p{Diacritic}/gu, '').toLowerCase().trim(),
    );
    db.run('CREATE TABLE recintos (' + w.columnasDdl + ')');
    const ins = db.prepare('INSERT INTO recintos VALUES (' + w.columnas.map(() => '?').join(',') + ')');
    for (const f of w.filas) ins.run(f);
    ins.free();
    db.run('PRAGMA query_only = 1');
    const st = db.prepare(w.sql);
    const filas = [];
    let hayMas = false;
    while (st.step()) {
      if (filas.length >= w.maxFilas) { hayMas = true; break; }
      filas.push(st.get().map(celda));
    }
    const columnas = st.getColumnNames();
    st.free();
    responder({ ok: true, columnas, filas, hayMas });
  } catch (e) {
    responder({ ok: false, error: String((e && e.message) || e).slice(0, 300) });
  } finally {
    if (db) db.close();
  }
}, (e) => responder({ ok: false, interno: true, error: String((e && e.message) || e) }));
`;

const COLUMNAS_DDL =
  'codigo TEXT, nombre TEXT, canton TEXT, parroquia TEXT, estado TEXT, numero_tecnico INTEGER, tecnico TEXT, tiene_contacto INTEGER';

/** Error del motor (no del SQL): no se le muestra al modelo como algo que pueda corregir. */
export class MotorSqlNoDisponible extends Error {}

/** Se resuelve al cargar el módulo: si falta la dependencia, falla al arrancar y no en una pregunta. */
const RUTA_SQL_JS = require.resolve('sql.js');

/**
 * Un solo hilo de SQL a la vez y una cola corta: en Render (0,1 vCPU) una ráfaga de
 * preguntas no debe multiplicar hilos y competir con el monitoreo de enlaces.
 */
export const MAX_SQL_SIMULTANEAS = 1;
export const MAX_SQL_EN_COLA = 3;
let enCurso = 0;
const cola: (() => void)[] = [];

async function tomarTurno(): Promise<void> {
  if (enCurso < MAX_SQL_SIMULTANEAS) {
    enCurso++;
    return;
  }
  if (cola.length >= MAX_SQL_EN_COLA) throw new MotorSqlNoDisponible('hay demasiadas consultas en curso');
  // El turno pasa directo de quien termina a quien espera: enCurso no cambia.
  await new Promise<void>((seguir) => cola.push(seguir));
}

function soltarTurno(): void {
  const siguiente = cola.shift();
  if (siguiente) siguiente();
  else enCurso--;
}

/**
 * Valida y ejecuta la consulta del modelo sobre una copia en memoria de `filas`.
 * Corre en un hilo aparte: una consulta lenta o infinita se corta a los
 * `tiempoMaxMs` sin frenar el resto del bot (alertas de enlaces incluidas).
 * Lanza ErrorSql si la consulta no es válida, falla o tarda demasiado.
 */
export async function ejecutarSql(sql: unknown, filas: FilaSql[], opciones: OpcionesSql = {}): Promise<ResultadoSql> {
  const consulta = validarSql(sql);
  await tomarTurno();
  try {
    return await correrEnHilo(consulta, filas, opciones);
  } finally {
    soltarTurno();
  }
}

function correrEnHilo(consulta: string, filas: FilaSql[], opciones: OpcionesSql): Promise<ResultadoSql> {
  const tiempoMax = opciones.tiempoMaxMs ?? TIEMPO_MAX_SQL_MS;
  return new Promise<ResultadoSql>((resolver, rechazar) => {
    const hilo = new Worker(CODIGO_HILO, {
      eval: true,
      workerData: {
        rutaSqlJs: RUTA_SQL_JS,
        memoria: MEMORIA_SQLITE,
        maxFilas: opciones.maxFilas ?? MAX_FILAS_SQL,
        maxLargoCelda: MAX_LARGO_CELDA,
        columnas: COLUMNAS,
        columnasDdl: COLUMNAS_DDL,
        filas: filas.map((f) => COLUMNAS.map((c) => f[c])),
        sql: consulta,
      },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
    });
    let terminado = false;
    const terminar = (accion: () => void) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(reloj);
      void hilo.terminate();
      accion();
    };
    const reloj = setTimeout(
      () => terminar(() => rechazar(new ErrorSql(`La consulta tardó más de ${tiempoMax / 1000} s. Simplifíquela.`))),
      tiempoMax,
    );
    hilo.on('message', (m: { ok: boolean; interno?: boolean; error?: string } & ResultadoSql) =>
      terminar(() => {
        if (m.ok) resolver({ columnas: m.columnas, filas: m.filas, hayMas: m.hayMas });
        else if (m.interno) rechazar(new MotorSqlNoDisponible(m.error));
        else rechazar(new ErrorSql(`SQLite: ${m.error}`));
      }),
    );
    hilo.on('error', (e: Error & { code?: string }) =>
      terminar(() =>
        rechazar(
          e.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? new ErrorSql('La consulta usa demasiada memoria. Simplifíquela.')
            : new MotorSqlNoDisponible(e.message),
        ),
      ),
    );
    hilo.on('exit', (codigo) =>
      terminar(() => rechazar(new MotorSqlNoDisponible(`el hilo de SQL terminó (código ${codigo})`))),
    );
  });
}
