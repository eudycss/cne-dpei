import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  /** 1 si el recinto tiene encargado con teléfono registrado, 0 si no, null si el Excel no se pudo leer. */
  tiene_contacto: 0 | 1 | null;
  /** Minutos que lleva caído ahora (null si está activo o no se sabe desde cuándo). */
  minutos_caido: number | null;
}

/** Una caída de la tabla `caidas` (historial reciente). Fechas en hora de Ecuador, 'AAAA-MM-DD HH:MM:SS'. */
export interface FilaCaidaSql {
  codigo: string;
  inicio: string;
  /** null = sigue caído. */
  fin: string | null;
  /** Duración en minutos (hasta ahora si sigue caído). */
  minutos: number;
}

/** Lo que se carga en la base en memoria para una consulta. */
export interface DatosSql {
  recintos: FilaSql[];
  caidas?: FilaCaidaSql[];
  /** Lo que devuelve ahora() en SQL, en hora de Ecuador; por defecto, el momento de la consulta. */
  ahora?: string;
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
/** Arrancar el hilo y cargar la tabla no cuenta para el tiempo de la consulta (Render tiene 0,1 vCPU). */
const TIEMPO_ARRANQUE_MS = 15_000;
/** Memoria máxima de SQLite dentro del hilo (un ORDER BY sobre millones de filas falla aquí). */
const MEMORIA_SQLITE = 32 * 1024 * 1024;
const MAX_LARGO_CELDA = 300;

const COLUMNAS = [
  'codigo',
  'nombre',
  'canton',
  'parroquia',
  'estado',
  'numero_tecnico',
  'tecnico',
  'tiene_contacto',
  'minutos_caido',
] as const;
const COLUMNAS_CAIDAS = ['codigo', 'inicio', 'fin', 'minutos'] as const;

// Ecuador continental no tiene horario de verano: UTC-5 todo el año.
const OFFSET_ECUADOR_MS = -5 * 60 * 60_000;

/** Instante → 'AAAA-MM-DD HH:MM:SS' en hora de Ecuador (el formato de fechas de SQLite). */
export function horaEcuadorSql(d: Date): string {
  return new Date(d.getTime() + OFFSET_ECUADOR_MS).toISOString().slice(0, 19).replace('T', ' ');
}

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
// SQLite ya compilado en el hilo principal (una sola vez): aquí solo se instancia.
const instantiateWasm = (imports, listo) => {
  WebAssembly.instantiate(w.wasm, imports).then((instancia) => listo(instancia, w.wasm));
  return {};
};
require(w.rutaSqlJs)({ instantiateWasm }).then((SQL) => {
  let db;
  try {
    db = new SQL.Database();
    // Con temp_store en memoria, los ordenamientos grandes también cuentan para el límite.
    db.run('PRAGMA temp_store = MEMORY');
    db.run('PRAGMA hard_heap_limit = ' + w.memoria);
    db.create_function('norm', (v) =>
      v === null || v === undefined ? null : String(v).normalize('NFD').replace(/\\p{Diacritic}/gu, '').toLowerCase().trim(),
    );
    // parecido(columna, 'willi'): mismas reglas que la búsqueda del bot (inicio de palabra
    // o 1 error de tipeo desde 4 letras, 2 desde 8), para nombres escritos a mano.
    const normal = (v) =>
      String(v).normalize('NFD').replace(/\\p{Diacritic}/gu, '').toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, ' ').trim();
    const distancia = (a, b) => {
      let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
      for (let i = 1; i <= a.length; i++) {
        const fila = [i];
        for (let j = 1; j <= b.length; j++) {
          fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        previa = fila;
      }
      return previa[b.length];
    };
    const coincide = (palabra, palabras) => {
      if (palabra.length < 3 || /^\\d+$/.test(palabra)) return palabras.includes(palabra);
      if (palabras.some((p) => p.startsWith(palabra))) return true;
      const errores = palabra.length >= 8 ? 2 : palabra.length >= 4 ? 1 : 0;
      return errores > 0 && palabras.some((p) => !/^\\d+$/.test(p) && distancia(palabra, p.slice(0, palabra.length + errores)) <= errores);
    };
    db.create_function('parecido', (texto, buscado) => {
      if (texto === null || texto === undefined || buscado === null || buscado === undefined) return 0;
      const delTexto = normal(texto).split(' ');
      const pedidas = normal(String(buscado).slice(0, 80)).split(' ').filter(Boolean);
      return pedidas.length > 0 && pedidas.every((p) => coincide(p, delTexto)) ? 1 : 0;
    });
    db.create_function('ahora', () => w.ahora);
    for (const t of w.tablas) {
      db.run('CREATE TABLE ' + t.nombre + ' (' + t.ddl + ')');
      const ins = db.prepare('INSERT INTO ' + t.nombre + ' VALUES (' + t.columnas.map(() => '?').join(',') + ')');
      for (const f of t.filas) ins.run(f);
      ins.free();
    }
    db.run('PRAGMA query_only = 1');
    responder({ listo: true });
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
  'codigo TEXT, nombre TEXT, canton TEXT, parroquia TEXT, estado TEXT, numero_tecnico INTEGER, tecnico TEXT, ' +
  'tiene_contacto INTEGER, minutos_caido INTEGER';
const COLUMNAS_CAIDAS_DDL = 'codigo TEXT, inicio TEXT, fin TEXT, minutos INTEGER';

/** Error del motor (no del SQL): no se le muestra al modelo como algo que pueda corregir. */
export class MotorSqlNoDisponible extends Error {}

/** Se resuelve al cargar el módulo: si falta la dependencia, falla al arrancar y no en una pregunta. */
const RUTA_SQL_JS = require.resolve('sql.js');

/** SQLite (WebAssembly) se compila una vez y se comparte con cada hilo: compilarlo por consulta es lento. */
let wasmCompilado: Promise<WebAssembly.Module> | null = null;
function sqliteCompilado(): Promise<WebAssembly.Module> {
  wasmCompilado ??= readFile(join(dirname(RUTA_SQL_JS), 'sql-wasm.wasm')).then((bytes) => WebAssembly.compile(bytes));
  // Si falló, se reintenta en la próxima consulta.
  wasmCompilado.catch(() => (wasmCompilado = null));
  return wasmCompilado;
}

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
 * Valida y ejecuta la consulta del modelo sobre una copia en memoria de los datos
 * (tablas `recintos` y `caidas`; una lista sola se toma como los recintos).
 * Corre en un hilo aparte: una consulta lenta o infinita se corta a los
 * `tiempoMaxMs` sin frenar el resto del bot (alertas de enlaces incluidas).
 * Lanza ErrorSql si la consulta no es válida, falla o tarda demasiado.
 */
export async function ejecutarSql(
  sql: unknown,
  datos: DatosSql | FilaSql[],
  opciones: OpcionesSql = {},
): Promise<ResultadoSql> {
  const consulta = validarSql(sql);
  await tomarTurno();
  try {
    return await correrEnHilo(consulta, Array.isArray(datos) ? { recintos: datos } : datos, opciones);
  } finally {
    soltarTurno();
  }
}

async function correrEnHilo(consulta: string, datos: DatosSql, opciones: OpcionesSql): Promise<ResultadoSql> {
  const tiempoMax = opciones.tiempoMaxMs ?? TIEMPO_MAX_SQL_MS;
  let wasm: WebAssembly.Module;
  try {
    wasm = await sqliteCompilado();
  } catch (e) {
    throw new MotorSqlNoDisponible(`no se pudo cargar SQLite: ${(e as Error)?.message ?? e}`);
  }
  return new Promise<ResultadoSql>((resolver, rechazar) => {
    const hilo = new Worker(CODIGO_HILO, {
      eval: true,
      workerData: {
        rutaSqlJs: RUTA_SQL_JS,
        wasm,
        memoria: MEMORIA_SQLITE,
        maxFilas: opciones.maxFilas ?? MAX_FILAS_SQL,
        maxLargoCelda: MAX_LARGO_CELDA,
        ahora: datos.ahora ?? horaEcuadorSql(new Date()),
        tablas: [
          { nombre: 'recintos', ddl: COLUMNAS_DDL, columnas: COLUMNAS, filas: datos.recintos.map((f) => COLUMNAS.map((c) => f[c] ?? null)) },
          {
            nombre: 'caidas',
            ddl: COLUMNAS_CAIDAS_DDL,
            columnas: COLUMNAS_CAIDAS,
            filas: (datos.caidas ?? []).map((f) => COLUMNAS_CAIDAS.map((c) => f[c])),
          },
        ],
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
    // Primero el arranque (cargar SQLite y la tabla); al avisar "listo", corre el tiempo de la consulta.
    let reloj = setTimeout(
      () => terminar(() => rechazar(new MotorSqlNoDisponible('el hilo de SQL tardó demasiado en arrancar'))),
      TIEMPO_ARRANQUE_MS,
    );
    hilo.on('message', (m: { ok: boolean; listo?: boolean; interno?: boolean; error?: string } & ResultadoSql) => {
      if (terminado) return;
      if (m.listo) {
        clearTimeout(reloj);
        reloj = setTimeout(
          () => terminar(() => rechazar(new ErrorSql(`La consulta tardó más de ${tiempoMax / 1000} s. Simplifíquela.`))),
          tiempoMax,
        );
        return;
      }
      terminar(() => {
        if (m.ok) resolver({ columnas: m.columnas, filas: m.filas, hayMas: m.hayMas });
        else if (m.interno) rechazar(new MotorSqlNoDisponible(m.error));
        else rechazar(new ErrorSql(`SQLite: ${m.error}`));
      });
    });
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
