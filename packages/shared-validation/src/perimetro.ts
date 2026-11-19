import { z } from 'zod';

// Plan de perímetro: despliegue de puestos, vallas y zonas sobre el mapa para un
// evento (lugar libre). Mismos límites que la app suelta plan-perimetro (logic.js).

export const LIMITES_PERIMETRO = Object.freeze({
  maxPuestos: 1000,
  maxVallas: 2000,
  maxZonas: 200,
  maxPuntosAnillo: 500,
  minLargoValla: 0.5,
  maxLargoValla: 10,
  maxNombre: 60,
  maxNombrePlan: 120,
  maxLugar: 200,
});

export const TIPOS_ZONA_PERIMETRO = ['peligro', 'precaucion', 'segura', 'acceso'] as const;
export type TipoZonaPerimetro = (typeof TIPOS_ZONA_PERIMETRO)[number];

const lat = z.number().finite().min(-90).max(90);
const lng = z.number().finite().min(-180).max(180);
/** [lat, lng], el mismo orden que usa la app suelta y sus planes JSON. */
const punto = z.tuple([lat, lng]);
/** Texto corto sin caracteres de control (se muestra en el mapa y en la impresión). */
const texto = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(max, `Máximo ${max} caracteres`)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'Contiene caracteres no permitidos');
/** Id local de zona/valla (lo genera la web; no es de la base). */
const idLocal = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Id inválido');

/** Anillo cerrado implícito: 3 a 500 vértices. */
export const anilloPerimetroSchema = z
  .array(punto)
  .min(3, 'El polígono necesita al menos 3 puntos')
  .max(LIMITES_PERIMETRO.maxPuntosAnillo, `Máximo ${LIMITES_PERIMETRO.maxPuntosAnillo} puntos`);

export const zonaPerimetroSchema = z.object({
  id: idLocal,
  tipo: z.enum(TIPOS_ZONA_PERIMETRO),
  nombre: texto(LIMITES_PERIMETRO.maxNombre),
  coords: anilloPerimetroSchema,
});

export const vallaPerimetroSchema = z.object({
  id: idLocal,
  lat,
  lng,
  /** Grados; se normaliza a [0, 180) porque la valla es simétrica. */
  angulo: z
    .number()
    .finite()
    .transform((a) => ((a % 180) + 180) % 180),
});

export const ajustesPerimetroSchema = z.object({
  pctMujeres: z.number().int().min(0).max(100).default(50),
  largoValla: z.number().finite().min(LIMITES_PERIMETRO.minLargoValla).max(LIMITES_PERIMETRO.maxLargoValla).default(2.5),
  mostrarNombres: z.boolean().default(true),
  alinearVallas: z.boolean().default(true),
});

/** La vista guardada, con giro (bearing) e inclinación 3D (pitch). */
export const vistaPerimetroSchema = z.object({
  lat,
  lng,
  zoom: z.number().finite().min(0).max(24),
  bearing: z
    .number()
    .finite()
    .default(0)
    .transform((b) => ((((b + 180) % 360) + 360) % 360) - 180),
  pitch: z.number().finite().min(0).max(85).default(0),
});

export const puestoPerimetroSchema = z.object({
  lat,
  lng,
  /** null = puesto sin persona todavía. */
  operadorCdaId: z.string().uuid().nullable().default(null),
  /** Nombre libre de un puesto sin persona del sistema (p. ej. "Policía 1"). */
  etiqueta: texto(LIMITES_PERIMETRO.maxNombre).nullable().default(null),
});

const datosPlanPerimetro = {
  nombre: texto(LIMITES_PERIMETRO.maxNombrePlan),
  lugar: texto(LIMITES_PERIMETRO.maxLugar).nullable().default(null),
  perimetro: anilloPerimetroSchema.nullable().default(null),
  zonas: z.array(zonaPerimetroSchema).max(LIMITES_PERIMETRO.maxZonas).default([]),
  vallas: z.array(vallaPerimetroSchema).max(LIMITES_PERIMETRO.maxVallas).default([]),
  ajustes: ajustesPerimetroSchema.default({}),
  vista: vistaPerimetroSchema.nullable().default(null),
  /** En orden: el índice es el número del puesto. */
  puestos: z.array(puestoPerimetroSchema).max(LIMITES_PERIMETRO.maxPuestos).default([]),
};

/** Una persona no puede estar en dos puestos del mismo plan; tampoco dos ids de zona/valla iguales. */
function sinRepetidos<T extends { zonas: { id: string }[]; vallas: { id: string }[]; puestos: { operadorCdaId: string | null }[] }>(
  plan: T,
  ctx: z.RefinementCtx,
): void {
  const personas = plan.puestos.map((p) => p.operadorCdaId).filter((id): id is string => id !== null);
  if (new Set(personas).size !== personas.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['puestos'], message: 'Una persona está en más de un puesto' });
  }
  if (new Set(plan.zonas.map((z) => z.id)).size !== plan.zonas.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['zonas'], message: 'Hay zonas con el mismo id' });
  }
  if (new Set(plan.vallas.map((v) => v.id)).size !== plan.vallas.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vallas'], message: 'Hay vallas con el mismo id' });
  }
}

export const crearPlanPerimetroSchema = z
  .object({ eventoId: z.string().uuid('Evento inválido'), ...datosPlanPerimetro })
  .strict()
  .superRefine(sinRepetidos);
export type CrearPlanPerimetroInput = z.infer<typeof crearPlanPerimetroSchema>;

/** Guardado completo; version es la que leyó la web (si cambió, el API responde 409). */
export const guardarPlanPerimetroSchema = z
  .object({ version: z.number().int().min(0), ...datosPlanPerimetro })
  .strict()
  .superRefine(sinRepetidos);
export type GuardarPlanPerimetroInput = z.infer<typeof guardarPlanPerimetroSchema>;

export const listarPlanesPerimetroSchema = z.object({ eventoId: z.string().uuid('Evento inválido') });

/** Lo guardado en la base (JSON) se vuelve a validar al leerlo: nunca se confía a ciegas. */
export const zonasPerimetroGuardadasSchema = z.array(zonaPerimetroSchema).max(LIMITES_PERIMETRO.maxZonas);
export const vallasPerimetroGuardadasSchema = z.array(vallaPerimetroSchema).max(LIMITES_PERIMETRO.maxVallas);

// --- Personal CDA/CPE en los puestos (de la persona solo sale id y nombre) ---

export const CENTROS_PERIMETRO = ['CDA', 'CPE'] as const;
export const MAX_CANDIDATOS_PERIMETRO = 100;

const claveCargo = z.string().regex(/^[A-Z0-9_]{1,40}$/, 'Cargo inválido');

/** Filtros del buscador de personal (query string). */
export const candidatosPerimetroSchema = z.object({
  centro: z.enum(CENTROS_PERIMETRO).optional(),
  cargo: claveCargo.optional(),
  buscar: z.string().trim().max(100).optional(),
});
export type CandidatosPerimetroInput = z.infer<typeof candidatosPerimetroSchema>;

/** Pedido de "Completar puestos vacíos": el servidor elige y ordena por % de mujeres. */
export const propuestaPersonalPerimetroSchema = z
  .object({
    total: z.number().int().min(1).max(LIMITES_PERIMETRO.maxPuestos),
    pctMujeres: z.number().int().min(0).max(100),
    centro: z.enum(CENTROS_PERIMETRO).optional(),
    cargo: claveCargo.optional(),
    /** Quienes ya están en el borrador (aún sin guardar): no se vuelven a proponer. */
    excluir: z.array(z.string().uuid()).max(LIMITES_PERIMETRO.maxPuestos).default([]),
  })
  .strict();
export type PropuestaPersonalPerimetroInput = z.infer<typeof propuestaPersonalPerimetroSchema>;
