import { z } from 'zod';

/**
 * Lo único que el modelo puede pedir: una consulta de esta lista, con sus
 * parámetros. Las consultas son de solo lectura y la respuesta la arma nuestro
 * código con los datos reales; el modelo nunca redacta lo que ve el usuario.
 */
const ESQUEMAS = {
  buscar_recinto: z.object({ texto: z.string().trim().min(1).max(80) }),
  recintos_caidos: z.object({ canton: z.string().trim().max(40).nullish() }),
  recintos_de_tecnico: z.object({
    nombre: z.string().trim().min(2).max(60),
    // Algunos modelos mandan el booleano como texto; cualquier otra cosa cuenta como false.
    solo_caidos: z.unknown().optional(),
  }),
  tecnicos_de_canton: z.object({ canton: z.string().trim().min(1).max(40) }),
  recintos_de_canton: z.object({ canton: z.string().trim().min(1).max(40) }),
};

export type Consulta =
  | { tipo: 'buscar_recinto'; texto: string }
  | { tipo: 'recintos_caidos'; canton: string | null }
  | { tipo: 'recintos_de_tecnico'; nombre: string; soloCaidos: boolean }
  | { tipo: 'tecnicos_de_canton'; canton: string }
  | { tipo: 'recintos_de_canton'; canton: string };

/** La consulta pedida por el modelo, o null si no está en la lista o sus parámetros no son válidos. */
export function validarConsulta(nombre: string, argumentos: unknown): Consulta | null {
  switch (nombre) {
    case 'buscar_recinto': {
      const r = ESQUEMAS.buscar_recinto.safeParse(argumentos);
      return r.success ? { tipo: 'buscar_recinto', texto: r.data.texto } : null;
    }
    case 'recintos_caidos': {
      const r = ESQUEMAS.recintos_caidos.safeParse(argumentos);
      return r.success ? { tipo: 'recintos_caidos', canton: r.data.canton || null } : null;
    }
    case 'recintos_de_tecnico': {
      const r = ESQUEMAS.recintos_de_tecnico.safeParse(argumentos);
      return r.success
        ? {
            tipo: 'recintos_de_tecnico',
            nombre: r.data.nombre,
            soloCaidos: String(r.data.solo_caidos).trim().toLowerCase() === 'true',
          }
        : null;
    }
    case 'tecnicos_de_canton': {
      const r = ESQUEMAS.tecnicos_de_canton.safeParse(argumentos);
      return r.success ? { tipo: 'tecnicos_de_canton', canton: r.data.canton } : null;
    }
    case 'recintos_de_canton': {
      const r = ESQUEMAS.recintos_de_canton.safeParse(argumentos);
      return r.success ? { tipo: 'recintos_de_canton', canton: r.data.canton } : null;
    }
    default:
      return null;
  }
}

/** Instrucciones para el modelo: solo elegir la consulta, nunca contestar con texto. */
export const INSTRUCCIONES_MODELO =
  'Eres el asistente del bot de enlaces de internet de los recintos electorales del CNE Imbabura (Ecuador). ' +
  'Tu único trabajo es elegir UNA herramienta y sus parámetros para responder la pregunta del usuario. ' +
  'No respondas con texto. Si la pregunta no se puede responder con estas herramientas, no llames a ninguna. ' +
  'En buscar_recinto pasa solo el nombre o código del recinto, o el lugar o parroquia (sin palabras como "teléfono", ' +
  '"contacto" o "encargado"); úsala también para "contacto de Ilumán" o "recinto de Golondrinas". ' +
  'Si preguntan qué técnico tiene, atiende o está en un cantón, usa tecnicos_de_canton, nunca buscar_recinto. ' +
  'Si piden listar o ver los recintos de un cantón, usa recintos_de_canton (si piden solo los caídos, recintos_caidos). ' +
  'Si piden solo los caídos de un técnico, usa recintos_de_tecnico con solo_caidos en true. ' +
  'Los cantones de Imbabura son Ibarra, Otavalo, Cotacachi, Antonio Ante, Urcuquí y Pimampiro.';

/** Definición de las consultas en el formato de herramientas compatible con OpenAI (Groq y Gemini). */
export const HERRAMIENTAS_MODELO = [
  {
    type: 'function',
    function: {
      name: 'buscar_recinto',
      description:
        'Busca un recinto por nombre o código y devuelve su ficha: estado del enlace, encargado con su teléfono ' +
        'y técnico asignado. Úsala para "número del encargado del colegio X", "cómo está el 1008", "quién atiende la escuela Y".',
      parameters: {
        type: 'object',
        properties: { texto: { type: 'string', description: 'Nombre (o parte) o código del recinto, p. ej. "colegio Ibarra" o "1008".' } },
        required: ['texto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recintos_caidos',
      description: 'Lista los recintos con el enlace caído ahora mismo, de toda la provincia o de un cantón.',
      parameters: {
        type: 'object',
        properties: { canton: { type: 'string', description: 'Cantón para filtrar (opcional), p. ej. "Cotacachi".' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recintos_de_tecnico',
      description: 'Lista los recintos asignados a un técnico, con el estado del enlace de cada uno.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre o apellido del técnico.' },
          solo_caidos: { type: 'boolean', description: 'true si piden solo los recintos con el enlace caído.' },
        },
        required: ['nombre'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tecnicos_de_canton',
      description:
        'Dice qué técnicos tienen asignados recintos de un cantón y cuántos recintos tiene cada uno. ' +
        'Úsala para "qué técnico está en Cotacachi", "quién atiende Ibarra", "técnicos de Otavalo".',
      parameters: {
        type: 'object',
        properties: { canton: { type: 'string', description: 'Cantón, p. ej. "Cotacachi".' } },
        required: ['canton'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recintos_de_canton',
      description:
        'Lista todos los recintos de un cantón, agrupados por técnico, con el estado del enlace de cada uno. ' +
        'Úsala para "listar recintos de Cotacachi", "qué recintos hay en Otavalo", "recintos de Ibarra".',
      parameters: {
        type: 'object',
        properties: { canton: { type: 'string', description: 'Cantón, p. ej. "Cotacachi".' } },
        required: ['canton'],
      },
    },
  },
];
