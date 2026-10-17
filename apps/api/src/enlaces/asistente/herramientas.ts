import { z } from 'zod';

/**
 * Lo único que el modelo puede pedir: una consulta de esta lista, con sus
 * parámetros. Las consultas son de solo lectura y la respuesta la arma nuestro
 * código con los datos reales; el modelo nunca redacta lo que ve el usuario.
 *
 * En vez de una consulta por cada pregunta posible, consultar_recintos recibe
 * filtros combinables: el modelo traduce la pregunta a filtros y el código los
 * aplica sobre la tabla de recintos (enlaces + técnicos + encargados).
 */

/** Algunos modelos mandan booleanos como texto ("true"); cualquier otra cosa es false. */
const booleano = z.unknown().transform((v) => String(v).trim().toLowerCase() === 'true');

/** Lista corta de textos; acepta también un texto suelto en vez de una lista. */
const listaTextos = z
  .union([z.string(), z.array(z.string())])
  .nullish()
  .transform((v) => (v == null ? [] : Array.isArray(v) ? v : [v]).map((t) => t.trim()).filter(Boolean))
  .pipe(z.array(z.string().max(60)).max(6));

export const ESTADOS = ['caido', 'activo'] as const;
export type EstadoFiltro = (typeof ESTADOS)[number];
export const AGRUPACIONES = ['tecnico', 'canton', 'parroquia', 'ninguno'] as const;
export type Agrupacion = (typeof AGRUPACIONES)[number];
export const PERIODOS = ['dia', 'semana', 'mes'] as const;
export type PeriodoConsulta = (typeof PERIODOS)[number];

/** Normaliza lo que mande el modelo ("Caído", "FALLO", "down") a un estado conocido, o null. */
function aEstado(v: unknown): EstadoFiltro | null {
  const t = String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
  if (['caido', 'caidos', 'fallo', 'falla', 'down', 'sin enlace'].includes(t)) return 'caido';
  if (['activo', 'activos', 'ok', 'up', 'con enlace'].includes(t)) return 'activo';
  return null;
}

function aOpcion<T extends string>(opciones: readonly T[], v: unknown): T | null {
  const t = String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
  return (opciones as readonly string[]).includes(t) ? (t as T) : null;
}

const ESQUEMAS = {
  buscar_recinto: z.object({ texto: z.string().trim().min(1).max(80) }),
  consultar_recintos: z.object({
    cantones: listaTextos,
    parroquias: listaTextos,
    tecnicos: listaTextos,
    estado: z.unknown().transform(aEstado),
    sin_tecnico: booleano,
    sin_contacto: booleano,
    con_contacto: booleano,
    agrupar_por: z.unknown().transform((v) => aOpcion(AGRUPACIONES, v)),
    solo_contar: booleano,
  }),
  estadisticas: z.object({
    periodo: z.unknown().transform((v) => {
      const t = String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
      return aOpcion(PERIODOS, { hoy: 'dia', ayer: 'dia' }[t] ?? t) ?? 'dia';
    }),
  }),
};

export interface FiltrosRecintos {
  cantones: string[];
  parroquias: string[];
  tecnicos: string[];
  estado: EstadoFiltro | null;
  sinTecnico: boolean;
  sinContacto: boolean;
  conContacto: boolean;
  /** null = el código elige según los filtros. */
  agruparPor: Agrupacion | null;
  soloContar: boolean;
}

export type Consulta =
  | { tipo: 'buscar_recinto'; texto: string }
  | ({ tipo: 'consultar_recintos' } & FiltrosRecintos)
  | { tipo: 'estadisticas'; periodo: PeriodoConsulta };

/** La consulta pedida por el modelo, o null si no está en la lista o sus parámetros no son válidos. */
export function validarConsulta(nombre: string, argumentos: unknown): Consulta | null {
  switch (nombre) {
    case 'buscar_recinto': {
      const r = ESQUEMAS.buscar_recinto.safeParse(argumentos);
      return r.success ? { tipo: 'buscar_recinto', texto: r.data.texto } : null;
    }
    case 'consultar_recintos': {
      const r = ESQUEMAS.consultar_recintos.safeParse(argumentos ?? {});
      if (!r.success) return null;
      const d = r.data;
      return {
        tipo: 'consultar_recintos',
        cantones: d.cantones,
        parroquias: d.parroquias,
        tecnicos: d.tecnicos,
        estado: d.estado,
        sinTecnico: d.sin_tecnico,
        sinContacto: d.sin_contacto,
        conContacto: d.con_contacto,
        agruparPor: d.agrupar_por,
        soloContar: d.solo_contar,
      };
    }
    case 'estadisticas': {
      const r = ESQUEMAS.estadisticas.safeParse(argumentos ?? {});
      return r.success ? { tipo: 'estadisticas', periodo: r.data.periodo } : null;
    }
    default:
      return null;
  }
}

/** Instrucciones para el modelo: solo elegir consultas, nunca contestar con texto. */
export const INSTRUCCIONES_MODELO =
  'Eres el asistente del bot de enlaces de internet de los recintos electorales del CNE Imbabura (Ecuador). ' +
  'Tu único trabajo es traducir la pregunta del usuario a llamadas de herramientas con sus parámetros. ' +
  'No respondas con texto. Si la pregunta no se puede responder con estas herramientas, no llames a ninguna. ' +
  'Usa buscar_recinto cuando preguntan por UN recinto concreto (por nombre, código, apodo o lugar), p. ej. ' +
  '"número del encargado del colegio Ibarra", "cómo está el 1008", "contacto de Ilumán", "recinto de Golondrinas"; ' +
  'pasa solo el nombre o lugar, sin palabras como "teléfono", "contacto" o "encargado". ' +
  'Usa consultar_recintos para listas, conteos y preguntas sobre varios recintos o técnicos, combinando filtros: ' +
  '"recintos de Pimampiro y Urcuquí" → cantones [Pimampiro, Urcuquí]; "qué está caído en Cotacachi" → cantones ' +
  '[Cotacachi], estado caido; "qué técnico está en Cotacachi" o "técnicos de Otavalo" → cantones, agrupar_por ' +
  'tecnico, solo_contar true; "qué técnicos tienen caídos" → estado caido, agrupar_por tecnico; "recintos de Willy" ' +
  '→ tecnicos [Willy]; "solo los caídos de Jairo" → tecnicos [Jairo], estado caido; "qué recintos no tienen ' +
  'técnico" → sin_tecnico true; "qué recintos no tienen contacto" → sin_contacto true; "cuántos caídos hay en ' +
  'Ibarra" → cantones [Ibarra], estado caido, solo_contar true; "contactos de los caídos" → estado caido, ' +
  'con_contacto true. ' +
  'Usa estadisticas para preguntas sobre caídas en el tiempo (hoy, esta semana, este mes, cuál se cayó más). ' +
  'Si la pregunta pide cosas distintas, puedes llamar hasta 3 herramientas. ' +
  'Los cantones de Imbabura son Ibarra, Otavalo, Cotacachi, Antonio Ante, Urcuquí y Pimampiro.';

/** Definición de las consultas en el formato de herramientas compatible con OpenAI (Groq y Gemini). */
export const HERRAMIENTAS_MODELO = [
  {
    type: 'function',
    function: {
      name: 'buscar_recinto',
      description:
        'Busca UN recinto por nombre, código, apodo o lugar (parroquia) y devuelve su ficha: estado del enlace, ' +
        'encargado con su teléfono y técnico asignado. Si hay varios parecidos, los lista con sus contactos.',
      parameters: {
        type: 'object',
        properties: {
          texto: { type: 'string', description: 'Nombre (o parte), código, apodo o lugar, p. ej. "colegio Ibarra", "1008", "Ilumán".' },
        },
        required: ['texto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_recintos',
      description:
        'Lista o cuenta recintos aplicando filtros combinables (todos opcionales; sin filtros, todos los recintos). ' +
        'Sirve para recintos de uno o varios cantones, parroquias o técnicos, los caídos, los que no tienen técnico ' +
        'o contacto, y para saber qué técnicos atienden un cantón o tienen caídos.',
      parameters: {
        type: 'object',
        properties: {
          cantones: { type: 'array', items: { type: 'string' }, description: 'Cantones, p. ej. ["Pimampiro", "Urcuquí"].' },
          parroquias: { type: 'array', items: { type: 'string' }, description: 'Parroquias, p. ej. ["San Juan de Ilumán"].' },
          tecnicos: { type: 'array', items: { type: 'string' }, description: 'Nombres o apellidos de técnicos.' },
          estado: { type: 'string', enum: ['caido', 'activo'], description: 'Solo los caídos o solo los activos.' },
          sin_tecnico: { type: 'boolean', description: 'Solo recintos sin técnico asignado.' },
          sin_contacto: { type: 'boolean', description: 'Solo recintos sin encargado o sin teléfono registrado.' },
          con_contacto: { type: 'boolean', description: 'Mostrar el encargado y teléfono de cada recinto.' },
          agrupar_por: { type: 'string', enum: ['tecnico', 'canton', 'parroquia', 'ninguno'], description: 'Cómo agrupar la lista.' },
          solo_contar: { type: 'boolean', description: 'Solo cuántos hay (por grupo si se agrupa), sin listar cada recinto.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'estadisticas',
      description:
        'Estadísticas de caídas de enlace de un período: recintos sin caídas, total de caídas, comparación con el ' +
        'período anterior y los recintos que más tiempo estuvieron sin enlace.',
      parameters: {
        type: 'object',
        properties: { periodo: { type: 'string', enum: ['dia', 'semana', 'mes'], description: 'dia = hoy.' } },
        required: ['periodo'],
      },
    },
  },
];
