import { z } from 'zod';

// Política de contraseña fuerte (HU1-CA3)
// - Entre 6 y 8 caracteres
// - Al menos una mayúscula, una minúscula, un dígito y un carácter especial
export const strongPasswordSchema = z
  .string()
  .min(6, 'La contraseña debe tener al menos 6 caracteres')
  .max(8, 'La contraseña no puede exceder 8 caracteres')
  .refine((v) => /[A-Z]/.test(v), 'Debe incluir al menos una mayúscula')
  .refine((v) => /[a-z]/.test(v), 'Debe incluir al menos una minúscula')
  .refine((v) => /\d/.test(v), 'Debe incluir al menos un dígito')
  .refine(
    (v) => /[^A-Za-z0-9]/.test(v),
    'Debe incluir al menos un carácter especial',
  );

// Cédula ecuatoriana: 10 dígitos + algoritmo módulo-10 (Registro Civil EC).
// Reglas:
// - Dígitos 1-2 (código de provincia): 01-24.
// - Dígito 3: 0-6 (persona natural).
// - Dígito 10 (verificador): módulo 10 sobre los primeros 9 dígitos con
//   coeficientes [2,1,2,1,2,1,2,1,2] — si el producto dígito*coeficiente es
//   >=10 se le resta 9; se suman todos los productos; si suma % 10 === 0 el
//   verificador esperado es 0, si no, 10 - (suma % 10).
// Exportada por separado para poder validar cédulas fuera de un form/schema
// (p. ej. en scripts de diagnóstico o servicios que no usan Zod).
export function isValidCedulaEcuatoriana(cedula: string): boolean {
  if (!/^\d{10}$/.test(cedula)) return false;

  const digitos = cedula.split('').map(Number);

  const provincia = Number(cedula.slice(0, 2));
  if (provincia < 1 || provincia > 24) return false;

  const tercerDigito = digitos[2];
  if (tercerDigito < 0 || tercerDigito > 6) return false;

  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let producto = digitos[i] * coeficientes[i];
    if (producto >= 10) producto -= 9;
    suma += producto;
  }

  const modulo = suma % 10;
  const verificadorEsperado = modulo === 0 ? 0 : 10 - modulo;
  return verificadorEsperado === digitos[9];
}

export const cedulaSchema = z
  .string()
  .regex(/^\d{10}$/, 'La cédula debe tener exactamente 10 dígitos')
  .refine(isValidCedulaEcuatoriana, 'Cédula ecuatoriana inválida');

export const emailSchema = z
  .string()
  .email('Email inválido')
  .max(255, 'El email no puede exceder 255 caracteres');

export const nombreSchema = z
  .string()
  .min(1, 'Requerido')
  .max(120, 'Máximo 120 caracteres');

// Normaliza el valor crudo antes de validar: quita espacios, guiones y
// paréntesis, y trata cadena vacía/null (celda de Excel/CSV vacía) como
// ausente — el schema sigue siendo opcional.
function normalizarTelefono(v: unknown): unknown {
  if (v === '' || v === null || v === undefined) return undefined;
  if (typeof v !== 'string') return v;
  const normalizado = v.replace(/[\s\-()]/g, '');
  return normalizado === '' ? undefined : normalizado;
}

// Celular ecuatoriano estricto: 09XXXXXXXX o +593 9XXXXXXXX (rechaza fijos
// y cualquier otro formato).
export const telefonoSchema = z.preprocess(
  normalizarTelefono,
  z
    .string()
    .regex(
      /^(?:\+593|0)9\d{8}$/,
      'Teléfono inválido: debe ser un celular ecuatoriano (ej. 0991234567 o +593991234567)',
    )
    .optional(),
);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Contraseña requerida'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Contraseña actual requerida'),
  newPassword: strongPasswordSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: strongPasswordSchema,
});

export const createUserSchema = z.object({
  cedula: cedulaSchema,
  email: emailSchema,
  nombres: nombreSchema,
  apellidos: nombreSchema,
  telefono: telefonoSchema,
});

export const updateUserSchema = z.object({
  cedula: cedulaSchema.optional(),
  email: emailSchema.optional(),
  nombres: nombreSchema.optional(),
  apellidos: nombreSchema.optional(),
  telefono: telefonoSchema,
  activo: z.boolean().optional(),
});

export const assignRolesSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
  roleIds: z.array(z.string().uuid()).min(1),
});

// Esquema usado para validar cada fila de Excel/CSV de carga masiva (HU7)
export const bulkUserRowSchema = z.object({
  cedula: cedulaSchema,
  email: emailSchema,
  nombres: nombreSchema,
  apellidos: nombreSchema,
  telefono: telefonoSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type BulkUserRow = z.infer<typeof bulkUserRowSchema>;

// ===================================================================
// FASE 2 — Catálogos y eventos
// ===================================================================

// --- Militares (HU8) ---
export const createMilitarSchema = z.object({
  cedula: cedulaSchema,
  nombres: nombreSchema,
  apellidos: nombreSchema,
  recintoId: z.string().uuid('Recinto inválido'),
});

export const updateMilitarSchema = z.object({
  cedula: cedulaSchema.optional(),
  nombres: nombreSchema.optional(),
  apellidos: nombreSchema.optional(),
  recintoId: z.string().uuid().optional(),
});

// Fila de Excel/CSV: el recinto se referencia por su código único
export const bulkMilitarRowSchema = z.object({
  cedula: cedulaSchema,
  nombres: nombreSchema,
  apellidos: nombreSchema,
  codigo_recinto: z.string().min(1, 'Código de recinto requerido'),
});

// --- Recintos electorales (HU8) ---
// Los textos se recortan: un espacio sobrante en el código ('  28') no coincide al buscar ni con el Sheet.
export const createRecintoSchema = z.object({
  codigoRecinto: z.string().trim().min(1, 'Requerido').max(20, 'Máximo 20 caracteres'),
  nombre: z.string().trim().min(1, 'Requerido').max(255, 'Máximo 255 caracteres'),
  direccion: z.string().trim().max(255).nullable().optional(),
  cantonId: z.number().int('Selecciona un cantón').positive('Selecciona un cantón'),
  parroquia: z.string().trim().max(120).nullable().optional(),
  zona: z.string().trim().max(120).nullable().optional(),
  tipo: z.enum(['CDA', 'NO_CDA']),
  latitud: z.number().min(-90, 'Latitud inválida').max(90, 'Latitud inválida'),
  longitud: z.number().min(-180, 'Longitud inválida').max(180, 'Longitud inválida'),
  tieneInternet: z.boolean().optional(),
  coberturaMovil: z.boolean().optional(),
  numeroElectores: z.number().int().nonnegative().nullable().optional(),
  juntasFemeninas: z.number().int().nonnegative().nullable().optional(),
  juntasMasculinas: z.number().int().nonnegative().nullable().optional(),
  esDificilAcceso: z.boolean().optional(),
});

export const updateRecintoSchema = createRecintoSchema.partial();

// Fila de Excel/CSV para carga masiva de recintos
export const bulkRecintoRowSchema = z.object({
  codigo_recinto: z.string().trim().min(1, 'Código requerido'),
  nombre: z.string().trim().min(1, 'Nombre requerido'),
  canton_codigo: z.string().trim().min(1, 'Código de cantón requerido'),
  tipo: z.enum(['CDA', 'NO_CDA']),
  parroquia: z.string().optional(),
  zona: z.string().optional(),
  latitud: z.coerce.number().min(-90).max(90),
  longitud: z.coerce.number().min(-180).max(180),
  tiene_internet: z.preprocess(
    (v) => { if (typeof v === 'boolean') return v; const s = String(v ?? '').trim().toLowerCase(); return s === '1' || s === 'si' || s === 'sí' || s === 'true'; },
    z.boolean(),
  ).optional(),
  cobertura_movil: z.preprocess(
    (v) => { if (typeof v === 'boolean') return v; const s = String(v ?? '').trim().toLowerCase(); return s === '1' || s === 'si' || s === 'sí' || s === 'true'; },
    z.boolean(),
  ).optional(),
  numero_electores: z.coerce.number().int().nonnegative().optional(),
  juntas_femeninas: z.coerce.number().int().nonnegative().optional(),
  juntas_masculinas: z.coerce.number().int().nonnegative().optional(),
  cda_destino_codigo: z.string().trim().optional(),
});

// --- Eventos electorales (HU20) ---
export const createEventoSchema = z.object({
  nombre: z.string().min(1, 'Requerido').max(160),
  tipo: z.string().min(1).max(50),
  fechaJornada: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)'),
  descripcion: z.string().max(2000).nullable().optional(),
});

export const updateEventoSchema = z.object({
  nombre: z.string().min(1).max(160).optional(),
  tipo: z.string().min(1).max(50).optional(),
  fechaJornada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  descripcion: z.string().max(2000).nullable().optional(),
});

/** 200 km: cubre toda la provincia, para eventos de prueba lejos del recinto real. */
export const MARGEN_LLEGADA_MAX_METROS = 200_000;

export const configAlertasSchema = z.object({
  umbralLlegadaRecintoMin: z.number().int().min(1).max(1440),
  umbralLlegadaDpiMin: z.number().int().min(1).max(1440),
  umbralSinSyncMin: z.number().int().min(1).max(1440),
  margenLlegadaMetros: z.number().int().min(10).max(MARGEN_LLEGADA_MAX_METROS),
});

export const closeEventoSchema = z.object({
  confirmar: z.literal(true, {
    errorMap: () => ({ message: 'Debes confirmar el cierre del evento' }),
  }),
  justificacion: z.string().max(1000).optional(),
});

// Reabrir un evento cerrado (solo para consulta): la justificación queda en la bitácora.
export const reopenEventoSchema = z.object({
  justificacion: z
    .string()
    .trim()
    .min(10, 'Explique en al menos 10 caracteres por qué se reabre el evento')
    .max(500),
});

// --- Asignaciones operador ↔ supervisor (HU10) ---
export const upsertAsignacionSchema = z.object({
  eventoId: z.string().uuid('Evento inválido'),
  operadorId: z.string().uuid('Operador inválido'),
  supervisorId: z.string().uuid('Supervisor inválido'),
});

// Fila de Excel/CSV para carga masiva de asignaciones operador↔supervisor.
// Ambos se referencian por cédula; a diferencia de los kits, aquí los dos
// campos son obligatorios porque una fila sin asignación no tiene sentido.
export const bulkAsignacionRowSchema = z.object({
  cedula_operador: z.string().min(1, 'Requerido'),
  cedula_supervisor: z.string().min(1, 'Requerido'),
});

export type BulkAsignacionRow = z.infer<typeof bulkAsignacionRowSchema>;

// --- Kits electorales (HU11) ---
export const ESTADOS_ITEM_KIT = ['BUENO', 'REGULAR', 'MALO'] as const;
export const estadoItemKitSchema = z.enum(ESTADOS_ITEM_KIT);

// Número de serie de un artículo. No puede empezar con = + - @ (una hoja de
// cálculo lo ejecutaría como fórmula al exportar) ni tener caracteres de control.
const SERIE_INVALIDA = /^[=+\-@]|[\u0000-\u001f\u007f]/;
export const MENSAJE_SERIE_INVALIDA = 'La serie no puede empezar con = + - @ ni tener caracteres de control';
export function esSerieValida(serie: string): boolean {
  return !SERIE_INVALIDA.test(serie);
}
export const serieItemSchema = z
  .string()
  .trim()
  .max(60, 'Máximo 60 caracteres')
  .refine(esSerieValida, MENSAJE_SERIE_INVALIDA);

// Un artículo del kit con su serie y estado (acta de cadena de custodia).
// Serie vacía = sin serie ("S/N" en el acta).
export const itemKitDetalleSchema = z.object({
  itemId: z.string().uuid(),
  serie: serieItemSchema.nullable().optional(),
  estado: estadoItemKitSchema.optional(),
});

export const createKitSchema = z.object({
  eventoId: z.string().uuid('Evento inválido'),
  nombre: z.string().min(1, 'Requerido').max(160),
  contenidos: z.string().max(1000).nullable().optional(),
  esPrueba: z.boolean().optional(),
  itemIds: z.array(z.string().uuid()).optional().default([]),
  // Si viene, reemplaza a itemIds y además guarda serie/estado de cada ítem.
  detalleItems: z.array(itemKitDetalleSchema).optional(),
  recintoId: z.string().uuid('Selecciona un recinto'),
});

// --- Catálogo de ítems de kit ---
export const createItemKitSchema = z.object({
  codigo: z.string().min(1, 'Requerido').max(50),
  etiqueta: z.string().min(1, 'Requerido').max(120),
});
export const updateItemKitSchema = z.object({
  etiqueta: z.string().min(1, 'Requerido').max(120).optional(),
  activo: z.boolean().optional(),
});

export const pdfQrSchema = z.object({
  kitIds: z.array(z.string().uuid()).min(1, 'Selecciona al menos un kit').max(200),
});

export const asignarKitSchema = z.object({
  operadorId: z.string().uuid('Operador inválido'),
  justificacion: z.string().max(500).optional(),
});

// Edición de un kit ya creado: permite cambiar el recinto y/o el contenido
// (ítems del catálogo). Todo opcional — PATCH parcial. `justificacion` cubre
// HU12-CA6 si el evento ya está congelado. El recinto solo se puede cambiar,
// nunca quitar (para un kit sin recinto, editar es la vía para dárselo).
export const editKitSchema = z
  .object({
    recintoId: z.string().uuid('Recinto inválido').optional(),
    itemIds: z.array(z.string().uuid()).optional(),
    detalleItems: z.array(itemKitDetalleSchema).optional(),
    justificacion: z.string().max(500).optional(),
  })
  .refine(
    (v) => v.recintoId !== undefined || v.itemIds !== undefined || v.detalleItems !== undefined,
    { message: 'Debes indicar al menos recintoId o los ítems del kit' },
  );

// HU12-CA6: justificación excepcional para modificar asignaciones con el
// evento ya congelado (jornada electoral iniciada).
export const desasignarKitSchema = z.object({
  justificacion: z.string().max(500).optional(),
});

// Fila de Excel/CSV para carga masiva de kits. El código único se autogenera;
// el operador se referencia por su cédula, el recinto por su código y el
// contenido por los códigos de ítems del catálogo (separados por coma).
// La asignación es opcional: si se omiten ambos, el kit queda en bodega.
export const bulkKitRowSchema = z
  .object({
    nombre: z.string().min(1, 'Nombre requerido').max(160),
    contenidos: z.string().max(1000).optional(),
    items: z.string().optional(),
    cedula_operador: z.string().optional(),
    codigo_recinto: z.string().optional(),
  })
  .refine(
    (r) => {
      const op = (r.cedula_operador ?? '').trim();
      const rec = (r.codigo_recinto ?? '').trim();
      // Para asignar se requieren ambos; o ninguno (kit en bodega).
      return (op === '' && rec === '') || (op !== '' && rec !== '');
    },
    { message: 'Para asignar el kit se requieren cédula_operador y código_recinto juntos' },
  );

export type CreateKitInput = z.infer<typeof createKitSchema>;
export type AsignarKitInput = z.infer<typeof asignarKitSchema>;
export type EditKitInput = z.infer<typeof editKitSchema>;
export type DesasignarKitInput = z.infer<typeof desasignarKitSchema>;
export type BulkKitRow = z.infer<typeof bulkKitRowSchema>;
export type CreateItemKitInput = z.infer<typeof createItemKitSchema>;
export type UpdateItemKitInput = z.infer<typeof updateItemKitSchema>;

// ===================================================================
// FASE 4 — Tracking del operador (HU2)
// ===================================================================
// La cola offline del móvil reenvía con `desdeOffline: true`; se guarda en
// `desde_offline` para auditar qué se registró sin señal y se sincronizó después.
// Lo declara el cliente: es un dato informativo, no confiable para autorizar ni
// para relajar validaciones (geocerca, alertas, etc.).
const desdeOffline = z.boolean().optional();

export const salidaDpiSchema = z.object({
  latitud: z.number().min(-90).max(90),
  longitud: z.number().min(-180).max(180),
  ocurridoEn: z
    .string()
    .datetime({ message: 'Fecha-hora ISO requerida' }),
  desdeOffline,
});

export type SalidaDpiInput = z.infer<typeof salidaDpiSchema>;

// HU3 — Llegada al recinto y recepción de kits
export const validarKitSchema = z.object({
  codigo: z.string().min(1, 'Código requerido').max(40),
});

export const recepcionKitSchema = z.object({
  kitId: z.string().uuid('Kit inválido'),
  fotoMilitarUrl: z.string().min(1, 'Foto del militar requerida'),
  militarId: z.string().uuid().nullable().optional(),
  latitud: z.number().min(-90).max(90),
  longitud: z.number().min(-180).max(180),
  desdeOffline,
});

export const llegadaRecintoSchema = z.object({
  latitud: z.number().min(-90).max(90),
  longitud: z.number().min(-180).max(180),
  ocurridoEn: z.string().datetime({ message: 'Fecha-hora ISO requerida' }),
  precisionMetros: z.number().nonnegative().nullable().optional(),
  desdeOffline,
});

export const llegadaNoCdaSchema = z.object({
  recintoId: z.string().uuid(),
  desdeOffline,
});

export const llegadaRecintoManualSchema = z.object({
  recintoId: z.string().uuid(),
});

// Prueba de conexión: el operador confirma a la vista que el recinto tiene
// conexión, después de la llegada y antes de la salida. Solo guarda la hora.
export const pruebaConexionSchema = z.object({
  ocurridoEn: z.string().datetime({ message: 'Fecha-hora ISO requerida' }),
  desdeOffline,
});

// HU4 — Salida del recinto y rastreo continuo
export const salidaRecintoSchema = z.object({
  latitud: z.number().min(-90).max(90),
  longitud: z.number().min(-180).max(180),
  ocurridoEn: z.string().datetime({ message: 'Fecha-hora ISO requerida' }),
  actaInstalacionUrl: z.string().min(1, 'Acta de instalación requerida'),
  actaEscrutinioUrl: z.string().min(1, 'Acta de escrutinio requerida'),
  desdeOffline,
});

export const ingestaPosicionesSchema = z.object({
  posiciones: z
    .array(
      z.object({
        latitud: z.number().min(-90).max(90),
        longitud: z.number().min(-180).max(180),
        capturadoEn: z.string().datetime({ message: 'Fecha-hora ISO requerida' }),
      }),
    )
    .min(1, 'Se requiere al menos una posición')
    .max(200, 'Máximo 200 posiciones por lote'),
});

// HU5 — Llegada al DPI
export const llegadaDpiSchema = z.object({
  latitud: z.number().min(-90).max(90),
  longitud: z.number().min(-180).max(180),
  ocurridoEn: z.string().datetime({ message: 'Fecha-hora ISO requerida' }),
  precisionMetros: z.number().nonnegative().nullable().optional(),
  desdeOffline,
});

// Verificación de kits al retorno al DPI (rol ASISTENTE_TRANSVERSAL)
// itemId/serie/estado solo existen para kits con ítems del catálogo; los kits
// legacy (texto libre) mandan solo texto + marcado.
export const itemChecklistSchema = z.object({
  texto: z.string().min(1),
  marcado: z.boolean(),
  itemId: z.string().uuid().optional(),
  serie: z.string().max(60).nullable().optional(),
  estado: estadoItemKitSchema.optional(),
});

export const verificarKitRetornoSchema = z
  .object({
    kitId: z.string().uuid('Kit inválido'),
    items: z.array(itemChecklistSchema).min(1),
    observaciones: z.string().max(500).nullable().optional(),
  })
  .refine(
    (d) => d.items.every((i) => i.marcado) || !!d.observaciones?.trim(),
    { message: 'Escribe una observación indicando qué falta', path: ['observaciones'] },
  );

export type ValidarKitInput = z.infer<typeof validarKitSchema>;
export type RecepcionKitInput = z.infer<typeof recepcionKitSchema>;
export type LlegadaRecintoInput = z.infer<typeof llegadaRecintoSchema>;
export type LlegadaNoCdaInput = z.infer<typeof llegadaNoCdaSchema>;
export type LlegadaRecintoManualInput = z.infer<typeof llegadaRecintoManualSchema>;
export type SalidaRecintoInput = z.infer<typeof salidaRecintoSchema>;
export type PruebaConexionInput = z.infer<typeof pruebaConexionSchema>;
export type IngestaPosicionesInput = z.infer<typeof ingestaPosicionesSchema>;
export type LlegadaDpiInput = z.infer<typeof llegadaDpiSchema>;
export type VerificarKitRetornoInput = z.infer<typeof verificarKitRetornoSchema>;

export type CreateMilitarInput = z.infer<typeof createMilitarSchema>;
export type BulkMilitarRow = z.infer<typeof bulkMilitarRowSchema>;
export type BulkRecintoRow = z.infer<typeof bulkRecintoRowSchema>;
export type CreateEventoInput = z.infer<typeof createEventoSchema>;
export type ConfigAlertasInput = z.infer<typeof configAlertasSchema>;
export type UpsertAsignacionInput = z.infer<typeof upsertAsignacionSchema>;

// ===================================================================
// HU14 — Incidencias
// ===================================================================

export const tipoIncidenciaEnum = z.enum([
  'KIT_DANADO',
  'KIT_FALTANTE',
  'PROBLEMA_RECINTO',
  'RETRASO',
  'PROBLEMA_SEGURIDAD',
  'OTRO',
]);

export const createIncidenciaSchema = z
  .object({
    tipo: tipoIncidenciaEnum,
    descripcion: z.string().max(1000).nullable().optional(),
    fotoBase64: z.string().nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    recintoId: z.string().uuid().nullable().optional(),
    kitId: z.string().uuid().nullable().optional(),
    desdeOffline: z.boolean().optional(),
  })
  .refine((d) => (d.lat == null) === (d.lng == null), {
    message: 'lat y lng deben venir juntos',
    path: ['lng'],
  });

export const updateEstadoIncidenciaSchema = z.object({
  estado: z.enum(['ATENDIDA', 'CERRADA']),
  comentario: z.string().max(1000).nullable().optional(),
});

export type CreateIncidenciaInput = z.infer<typeof createIncidenciaSchema>;
export type UpdateEstadoIncidenciaInput = z.infer<typeof updateEstadoIncidenciaSchema>;

// --- Alertas (HU18) ---
export const updateEstadoAlertaSchema = z.object({
  estado: z.enum(['VISTA', 'ATENDIDA']),
});

// --- Alertas de enlaces caídos (CDAs Imbabura) ---
export const addCorreoEnlaceSchema = z.object({
  correo: emailSchema,
});

/** Opciones de los avisos por Telegram: 10 min (día de votaciones) a 4 h. El cron corre cada 5 min. */
export const MINUTOS_AVISO_ENLACES = [10, 15, 30, 60, 120, 240] as const;
const minutosAvisoSchema = z
  .number()
  .int()
  .refine((m) => (MINUTOS_AVISO_ENLACES as readonly number[]).includes(m), {
    message: `Elija uno de: ${MINUTOS_AVISO_ENLACES.join(', ')} minutos`,
  });
export const avisosEnlacesSchema = z.object({
  minutosPrimerAviso: minutosAvisoSchema,
  minutosRepetirAviso: minutosAvisoSchema,
});

// --- Cadena de custodia del kit (rol ASISTENTE_TRANSVERSAL) ---
const motivoCorreccionSchema = z
  .string()
  .trim()
  .min(5, 'Explica el motivo (mínimo 5 caracteres)')
  .max(500, 'Máximo 500 caracteres');

export const registrarEntregaSchema = z.object({
  kitId: z.string().uuid('Kit inválido'),
  militarId: z.string().uuid('Selecciona un militar'),
});

export const corregirMilitarSchema = z.object({
  militarId: z.string().uuid('Selecciona un militar'),
  motivo: motivoCorreccionSchema,
});

export const cambiarOperadorSchema = z.object({
  operadorId: z.string().uuid('Selecciona un operador'),
  motivo: motivoCorreccionSchema,
});

export type RegistrarEntregaInput = z.infer<typeof registrarEntregaSchema>;
export type CorregirMilitarInput = z.infer<typeof corregirMilitarSchema>;
export type CambiarOperadorInput = z.infer<typeof cambiarOperadorSchema>;

// --- Operadores CDA ---
/** "2026-02-31" tiene formato válido pero no existe; también acota el año. */
function esFechaReal(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  const anio = Number(iso.slice(0, 4));
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso) && anio >= 2020 && anio <= 2100;
}

// Una fila del Excel de talento humano ya normalizada por la API (encabezados
// "N°, Apellidos Nombres, Cédula, Teléfonos De Contacto, Cargo, Unidad, Inicial").
export const operadorCdaFilaSchema = z.object({
  numero: z.number().int().positive().optional(),
  apellidosNombres: z
    .string()
    .trim()
    .min(3, 'Apellidos y nombres requeridos')
    .max(200, 'Máximo 200 caracteres'),
  cedula: cedulaSchema,
  telefono: telefonoSchema,
  cargo: z.string().trim().min(1, 'Cargo requerido').max(160, 'Máximo 160 caracteres'),
  unidad: z.string().trim().max(200, 'Máximo 200 caracteres').optional(),
  fechaInicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (use AAAA-MM-DD)')
    .refine(esFechaReal, 'Fecha inexistente o fuera de rango (2020-2100)')
    .optional(),
});

export type OperadorCdaFilaInput = z.infer<typeof operadorCdaFilaSchema>;

/** Operadores CDA o Asistentes CDA. */
export const grupoCdaSchema = z.enum(['OPERADOR', 'ASISTENTE'], {
  errorMap: () => ({ message: 'Grupo inválido (OPERADOR o ASISTENTE)' }),
});

/** Para ?grupo= en la URL: ausente = OPERADOR (lo que había antes de los asistentes). */
export const grupoCdaQuerySchema = grupoCdaSchema.default('OPERADOR');

// Alta manual: los mismos campos que una fila del Excel, sin el N° de la hoja.
export const crearOperadorCdaSchema = operadorCdaFilaSchema
  .omit({ numero: true })
  .extend({ grupo: grupoCdaSchema.optional() })
  .strict();
export type CrearOperadorCdaInput = z.infer<typeof crearOperadorCdaSchema>;

// Edición: la cédula no cambia (es la llave con la que el Excel reimporta) y
// el grupo tampoco (una persona está en un solo grupo).
// Un campo opcional ausente o vacío se guarda vacío: el formulario manda todo.
export const editarOperadorCdaSchema = crearOperadorCdaSchema.omit({ cedula: true, grupo: true }).strict();
export type EditarOperadorCdaInput = z.infer<typeof editarOperadorCdaSchema>;

export const cambiarActivoOperadorCdaSchema = z.object({ activo: z.boolean() }).strict();

export const tipoMarcaAsistenciaCdaSchema = z.enum(['ENTRADA', 'SALIDA']);
export type TipoMarcaAsistenciaCdaInput = z.infer<typeof tipoMarcaAsistenciaCdaSchema>;

export const marcarAsistenciaCdaSchema = z.object({ tipo: tipoMarcaAsistenciaCdaSchema });

export const marcarAsistenciaCdaMasivaSchema = z.object({
  tipo: tipoMarcaAsistenciaCdaSchema,
  operadorIds: z.array(z.string().uuid()).min(1, 'Seleccione al menos un operador').max(500),
});

// Credencial QR (carnet) de operador CDA.

/**
 * Token del carnet: "CDA1" + 26 caracteres base32 (A-Z, 2-7) = 128 bits. Solo
 * mayúsculas y dígitos: un lector USB "teclea" igual con distribución de
 * teclado US o latinoamericana (los "-", "_" o "." cambian de tecla). Se
 * aceptan minúsculas (Bloq Mayús) y espacios alrededor.
 */
export const tokenCredencialQrCdaSchema = z
  .string({ invalid_type_error: 'Código inválido' })
  .trim()
  .toUpperCase()
  .regex(/^CDA1[A-Z2-7]{26}$/, 'Código no reconocido: no es un carnet CDA');

export const consultarQrCdaSchema = z.object({ token: tokenCredencialQrCdaSchema }).strict();

export const marcarQrCdaSchema = z.object({ token: tokenCredencialQrCdaSchema, tipo: tipoMarcaAsistenciaCdaSchema }).strict();

export const emitirCarnetsCdaSchema = z
  .object({ operadorIds: z.array(z.string().uuid()).min(1, 'Seleccione al menos un operador').max(200) })
  .strict();

/** Día en formato AAAA-MM-DD (calendario de Ecuador). */
export const diaAsistenciaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (use AAAA-MM-DD)')
  .refine(esFechaReal, 'Fecha inexistente o fuera de rango (2020-2100)');

/** Máximo de días del reporte de atrasos (igual que el Excel de asistencia). */
export const MAX_DIAS_REPORTE_ASISTENCIA = 120;

// Hora oficial de entrada (Ecuador) y minutos de gracia: hasta hora + gracia es puntual.
export const configAsistenciaCdaSchema = z
  .object({
    horaEntrada: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (use HH:MM, 00:00 a 23:59)'),
    minutosGracia: z
      .number({ invalid_type_error: 'Ingrese los minutos de gracia' })
      .int('Use minutos enteros')
      .min(0, 'Mínimo 0 minutos')
      .max(120, 'Máximo 120 minutos'),
  })
  .strict();
export type ConfigAsistenciaCdaInput = z.infer<typeof configAsistenciaCdaSchema>;

export const rangoAsistenciaSchema = z
  .object({ desde: diaAsistenciaSchema, hasta: diaAsistenciaSchema })
  .refine((r) => r.desde <= r.hasta, { message: 'La fecha inicial es posterior a la final', path: ['desde'] })
  .refine(
    (r) =>
      (Date.parse(`${r.hasta}T00:00:00Z`) - Date.parse(`${r.desde}T00:00:00Z`)) / 86_400_000 <
      MAX_DIAS_REPORTE_ASISTENCIA,
    { message: `El rango es demasiado largo (máximo ${MAX_DIAS_REPORTE_ASISTENCIA} días)`, path: ['hasta'] },
  );
export type RangoAsistenciaInput = z.infer<typeof rangoAsistenciaSchema>;

/**
 * El PDF cuesta mucha más CPU que el Excel (Render: 0.1 vCPU) y más de un mes
 * no se imprime: para rangos largos, Excel.
 */
export const MAX_DIAS_REPORTE_PDF = 31;

export function diasDelRango(desde: string, hasta: string): number {
  return (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000 + 1;
}

export const MENSAJE_MAX_DIAS_PDF = `En PDF el rango máximo es de ${MAX_DIAS_REPORTE_PDF} días; para más, use Excel`;

/** Sin `modo` (enlaces viejos), el reporte sale general. */
export const modoReporteCdaSchema = z
  .enum(['GENERAL', 'POR_DIA'], { errorMap: () => ({ message: 'Modo de reporte inválido (GENERAL o POR_DIA)' }) })
  .default('GENERAL');

// Enlace de foto de operador CDA (página pública).

/** Versión del aviso de consentimiento LOPDP que acepta el operador. Cambiarla si cambia el texto. */
export const VERSION_AVISO_FOTO_CDA = 'LOPDP-2026-10';

/** Token del enlace: 32 bytes aleatorios en base64url. */
export const tokenFotoCdaSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Enlace inválido');

export const consultarEnlaceFotoCdaSchema = z.object({ token: tokenFotoCdaSchema });

/** Campos de texto que acompañan a la foto (multipart). */
export const subirFotoCdaSchema = z.object({
  token: tokenFotoCdaSchema,
  consentimiento: z.literal('true', {
    errorMap: () => ({ message: 'Debe autorizar el uso de su foto para continuar' }),
  }),
  version: z.literal(VERSION_AVISO_FOTO_CDA, {
    errorMap: () => ({ message: 'El aviso cambió: recargue la página y léalo de nuevo' }),
  }),
});

// Actas de entrega de indumentaria y credencial (operadores CDA).

export const estadoPrendaSchema = z.enum(['NUEVO', 'BUENO', 'REGULAR', 'MALO']);
export type EstadoPrendaInput = z.infer<typeof estadoPrendaSchema>;

/** Hasta cuántas actas se generan o descargan de una vez (los 56 operadores caben). */
export const MAX_ACTAS_CDA_LOTE = 100;

/** Texto libre del acta: sin caracteres de control (dejarían el Word dañado). */
const textoActa = (min: number, max: number, requerido: string) =>
  z
    .string()
    .trim()
    .min(min, requerido)
    .max(max, `Máximo ${max} caracteres`)
    .refine((v) => !/[\u0000-\u001F\u007F]/.test(v), 'Contiene caracteres no permitidos');

const operadorIdsActasSchema = z
  .array(z.string().uuid())
  .min(1, 'Seleccione al menos un operador')
  .max(MAX_ACTAS_CDA_LOTE, `Máximo ${MAX_ACTAS_CDA_LOTE} operadores a la vez`);

/**
 * Quién entrega: nombre, cédula y cargo van siempre (se prellenan desde el
 * usuario elegido y se pueden corregir, p. ej. el nombre completo). Con
 * `entregaUsuarioId` la API comprueba que la cédula sea la de ese usuario; sin
 * él es "otra persona" (un técnico de enlaces sin usuario en el sistema).
 */
export const generarActasCdaSchema = z.object({
  operadorIds: operadorIdsActasSchema,
  entregaUsuarioId: z.string().uuid().optional(),
  entregaNombre: textoActa(3, 200, 'Nombre requerido'),
  entregaCedula: cedulaSchema,
  entregaCargo: textoActa(3, 160, 'Cargo requerido'),
  fecha: diaAsistenciaSchema,
  lugar: textoActa(2, 80, 'Lugar requerido'),
  estadoPeto: estadoPrendaSchema,
  estadoCredencial: estadoPrendaSchema,
  estadoCordon: estadoPrendaSchema,
});
export type GenerarActasCdaInput = z.infer<typeof generarActasCdaSchema>;

export const descargarActasCdaSchema = z.object({ operadorIds: operadorIdsActasSchema });

export * from './modulos';
export * from './permisos';
