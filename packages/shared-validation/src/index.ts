import { z } from 'zod';

// Política de contraseña fuerte (HU1-CA3)
// - Entre 6 y 12 caracteres
// - Al menos una mayúscula, una minúscula, un dígito y un carácter especial
export const strongPasswordSchema = z
  .string()
  .min(6, 'La contraseña debe tener al menos 6 caracteres')
  .max(12, 'La contraseña no puede exceder 12 caracteres')
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

// Los Operadores/Asistentes CDA entran con cédula; el personal administrativo
// con correo. `email` se sigue aceptando como alias para las APK ya instaladas.
function normalizarLogin(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const { email, usuario, ...resto } = input as Record<string, unknown>;
  const valor = usuario ?? email;
  if (typeof valor !== 'string') return { ...resto, usuario: valor };
  const limpio = valor.trim();
  return { ...resto, usuario: limpio.includes('@') ? limpio : limpio.replace(/[\s-]/g, '') };
}

export const loginSchema = z.preprocess(
  normalizarLogin,
  z.object({
    usuario: z.union([cedulaSchema, emailSchema], {
      errorMap: () => ({ message: 'Ingrese su cédula o correo' }),
    }),
    password: z.string().min(1, 'Contraseña requerida'),
  }),
);

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

// Restablecer claves en bloque: como mucho 500, el mismo tope que el listado.
export const resetPasswordBulkSchema = z.object({
  // Tope por petición: la web envía por lotes (cada uno = un hash argon2 por usuario).
  userIds: z.array(z.string().uuid()).min(1).max(50),
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
  // CDA: a dónde dirigirse si hay un problema con el kit. Vacío = sin configurar.
  contingenciaNombre: z.string().trim().max(255, 'Máximo 255 caracteres').nullable().optional().transform((v) => (v === '' ? null : v)),
  contingenciaDireccion: z.string().trim().max(255, 'Máximo 255 caracteres').nullable().optional().transform((v) => (v === '' ? null : v)),
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
  // El recinto lleva otro dispositivo: acepta un segundo kit real en él.
  otroDispositivo: z.boolean().optional(),
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
// --- N.º de mochila del kit (número pintado en la mochila física con el QR) ---
export const MAX_NUMERO_MOCHILA = 9999;
export const MAX_FILAS_CARGA_MOCHILAS = 2000;
export const numeroMochilaSchema = z
  .number({ invalid_type_error: 'El N.º de mochila debe ser un número' })
  .int('El N.º de mochila debe ser un número entero')
  .min(1, 'El N.º de mochila va de 1 a 9999')
  .max(MAX_NUMERO_MOCHILA, 'El N.º de mochila va de 1 a 9999');
export const numeroMochilaRequestSchema = z.object({
  numero: numeroMochilaSchema.nullable(),
  reemplazar: z.boolean().optional(),
});
/**
 * Lee el N.º de mochila escrito en una celda o un campo: "45", "045", "N.º 45",
 * "#45", "M-45" → 45. null si no es un número de 1 a 9999.
 */
export function leerNumeroMochila(valor: unknown): number | null {
  const texto = String(valor ?? '').trim();
  const m = /^(?:n\.?\s*[º°o]?\.?|no\.?|#|m-?|mochila)?\s*(\d{1,4})(?:\.0+)?$/i.exec(texto);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= MAX_NUMERO_MOCHILA ? n : null;
}

/** Lo leído de un QR de kit (el QR trae solo el código): mayúsculas, sin espacios; null si no parece un código. */
export function leerCodigoQrKit(valor: unknown): string | null {
  const codigo = String(valor ?? '').trim().toUpperCase();
  return /^[A-Z0-9-]{4,40}$/.test(codigo) ? codigo : null;
}

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

// El operador olvidó marcar la llegada al DPEI: el administrador la registra
// desde la web y deja constancia del motivo.
export const llegadaDpiManualSchema = z
  .object({
    motivo: z.string().trim().min(5, 'Escriba el motivo (mínimo 5 caracteres)').max(500, 'Máximo 500 caracteres'),
  })
  .strict();

// Prueba de conexión: el operador confirma a la vista que el recinto tiene
// conexión, después de la llegada y antes de la salida. Guarda la hora y la
// foto de la computadora del test (opcional aquí por las APK viejas).
export const pruebaConexionSchema = z.object({
  ocurridoEn: z.string().datetime({ message: 'Fecha-hora ISO requerida' }),
  fotoUrl: z.string().min(1).max(512).optional(),
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
    // Vacía solo en kits sin artículos registrados; si el kit los tiene, la
    // API exige la lista completa (checklistDesdeBd).
    items: z.array(itemChecklistSchema),
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

/** 0 = detenido: el bot no manda resúmenes automáticos (ni el cierre) hasta que se elija otra frecuencia. */
export const RESUMEN_JORNADA_DETENIDO = 0;
/**
 * Cada cuánto puede mandar el bot el resumen automático del grupo Jornada (web y botones del bot).
 * El último es RESUMEN_JORNADA_DETENIDO: quien recorra la lista debe tratarlo aparte.
 */
export const MINUTOS_RESUMEN_JORNADA = [5, 10, 15, 30, 60, 120, 240, 480, RESUMEN_JORNADA_DETENIDO] as const;
export const MINUTOS_RESUMEN_JORNADA_POR_DEFECTO = 15;
export function esMinutosResumenJornada(m: unknown): m is number {
  return typeof m === 'number' && (MINUTOS_RESUMEN_JORNADA as readonly number[]).includes(m);
}
/** "15 min", "4 h" o "Detenido" (web y bot dicen lo mismo). */
export function textoFrecuenciaResumenJornada(minutos: number): string {
  if (minutos === RESUMEN_JORNADA_DETENIDO) return 'Detenido';
  return minutos < 60 ? `${minutos} min` : `${minutos / 60} h`;
}
export const resumenJornadaSchema = z.object({
  minutosResumenJornada: z
    .number()
    .int()
    .refine(esMinutosResumenJornada, {
      message: `Elija uno de: ${MINUTOS_RESUMEN_JORNADA.filter((m) => m !== RESUMEN_JORNADA_DETENIDO).join(', ')} minutos, o detener`,
    }),
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

/** Fecha de ingreso del personal CDA (columna fecha_inicio). */
const fechaIngresoCdaSchema = z
  .string({ required_error: 'Fecha de ingreso requerida' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (use AAAA-MM-DD)')
  .refine(esFechaReal, 'Fecha inexistente o fuera de rango (2020-2100)');

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
  fechaInicio: fechaIngresoCdaSchema.optional(),
});

export type OperadorCdaFilaInput = z.infer<typeof operadorCdaFilaSchema>;

/**
 * Los 9 cargos con los que nació la tabla de cargos (cada uno con su propia
 * gestión). El administrador puede agregar más desde la web: la lista
 * completa está en la base (cargos_cda) y la API revisa que la clave exista.
 */
export const GRUPOS_CDA = [
  'OPERADOR',
  'ASISTENTE',
  'DIGITADOR',
  'ASISTENTE_ARCHIVOS',
  'ASISTENTE_FIRMAS',
  'RECEPTOR_ACTAS',
  'ARCHIVADOR_ACTAS',
  'SUPERVISOR',
  'OPERADOR_ESCANER_CPE',
] as const;

/** Clave de un cargo: MAYÚSCULAS, dígitos y "_" (la forma de las 9 originales). */
export const grupoCdaSchema = z
  .string({ invalid_type_error: 'Grupo inválido' })
  .regex(/^[A-Z][A-Z0-9_]{0,39}$/, 'Grupo inválido');

export const CENTROS_CDA = ['CDA', 'CPE'] as const;

/**
 * Nombre visible de un cargo: empieza con letra o número (va a Excel y PDF);
 * luego letras, números, espacios y . , ( ) - /
 */
const nombreCargoCdaSchema = z
  .string({ required_error: 'Nombre requerido' })
  .transform((s) => s.trim().replace(/ +/g, ' '))
  .pipe(
    z
      .string()
      .min(3, 'Mínimo 3 caracteres')
      .max(80, 'Máximo 80 caracteres')
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} .,()\-/]*$/u, 'Empiece con letra o número; use solo letras, números, espacios y . , ( ) - /'),
  );

/** Cargo nuevo: el centro se elige aquí y después no cambia. */
export const crearCargoCdaSchema = z
  .object({ nombre: nombreCargoCdaSchema, centro: z.enum(CENTROS_CDA, { errorMap: () => ({ message: 'Centro inválido' }) }) })
  .strict();

export const renombrarCargoCdaSchema = z.object({ nombre: nombreCargoCdaSchema }).strict();

export const cambiarActivoCargoCdaSchema = z.object({ activo: z.boolean() }).strict();

/** Para ?grupo= en la URL: ausente = OPERADOR (lo que había antes de los asistentes). */
export const grupoCdaQuerySchema = grupoCdaSchema.default('OPERADOR');

// Alta manual: los mismos campos que una fila del Excel, sin el N° de la hoja.
// La fecha de ingreso es obligatoria (en el Excel sigue opcional).
export const crearOperadorCdaSchema = operadorCdaFilaSchema
  .omit({ numero: true })
  .extend({
    grupo: grupoCdaSchema.optional(),
    fechaInicio: fechaIngresoCdaSchema,
  })
  .strict();
export type CrearOperadorCdaInput = z.infer<typeof crearOperadorCdaSchema>;

// Edición: la cédula no cambia (es la llave con la que el Excel reimporta) y
// el grupo tampoco (una persona está en un solo grupo).
// Un campo opcional ausente o vacío se guarda vacío: el formulario manda todo.
// La fecha de ingreso sigue opcional: hay registros antiguos sin ella.
export const editarOperadorCdaSchema = operadorCdaFilaSchema.omit({ numero: true, cedula: true }).strict();
export type EditarOperadorCdaInput = z.infer<typeof editarOperadorCdaSchema>;

export const cambiarActivoOperadorCdaSchema = z.object({ activo: z.boolean() }).strict();

/** Celular de la persona (la APK solo se instala en Android). */
export const dispositivoCdaSchema = z.enum(['ANDROID', 'IPHONE']);
export const cambiarDispositivoOperadorCdaSchema = z.object({ dispositivo: dispositivoCdaSchema.nullable() }).strict();

/** Pasar a una persona a otro cargo CDA (rige desde hoy). */
export const cambiarCargoOperadorCdaSchema = z.object({ grupo: grupoCdaSchema }).strict();

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

const horaMarcaSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (use HH:MM, 00:00 a 23:59)');

/**
 * Corrección de un día pasado: deja la entrada y la salida como se indican
 * (null = sin marca), con un motivo que queda en la bitácora.
 */
export const corregirAsistenciaCdaSchema = z
  .object({
    entrada: horaMarcaSchema.nullable(),
    salida: horaMarcaSchema.nullable(),
    motivo: z
      .string({ required_error: 'Indique el motivo' })
      .trim()
      .min(10, 'Explique el motivo (mínimo 10 caracteres)')
      .max(300, 'Máximo 300 caracteres'),
  })
  .strict()
  .refine((c) => !c.salida || c.entrada, { message: 'Sin entrada no puede haber salida', path: ['salida'] })
  .refine((c) => !c.salida || !c.entrada || c.salida > c.entrada, {
    message: 'La salida debe ser posterior a la entrada',
    path: ['salida'],
  });
export type CorregirAsistenciaCdaInput = z.infer<typeof corregirAsistenciaCdaSchema>;

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

/** Máximo de personas en la convocatoria de un día (todo el personal CDA y CPE cabe con holgura). */
export const MAX_CONVOCADOS_CDA = 2000;
/** Convocados a mano de un día: reemplaza la lista de esa fecha (los de Parejas van solos). */
export const guardarConvocatoriaCdaSchema = z
  .object({
    operadorIds: z
      .array(z.string().uuid('Persona inválida'))
      .max(MAX_CONVOCADOS_CDA, `Máximo ${MAX_CONVOCADOS_CDA} personas`)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();
export type GuardarConvocatoriaCdaInput = z.infer<typeof guardarConvocatoriaCdaSchema>;
/** Filas y fechas distintas como máximo en un Excel de convocatoria. */
export const MAX_FILAS_CARGA_CONVOCATORIA = 5000;
export const MAX_FECHAS_CARGA_CONVOCATORIA = 120;

/**
 * Cédula escrita en una celda: solo dígitos; si Excel le quitó el 0 inicial
 * (9 dígitos), se lo devuelve. null si no son 10 dígitos.
 */
export function leerCedulaCelda(valor: unknown): string | null {
  const texto = String(valor ?? '').trim();
  // Solo dígitos, puntos, guiones y espacios: con letras puede ser otro dato pegado.
  if (!/^[\d.\-\s]+$/.test(texto)) return null;
  const digitos = texto.replace(/\D/g, '');
  const cedula = digitos.length === 9 ? `0${digitos}` : digitos;
  return /^\d{10}$/.test(cedula) ? cedula : null;
}

/**
 * Fecha de una celda: "2026-11-05", "05/11/2026" (día/mes/año) o la fecha que
 * entrega Excel. Devuelve AAAA-MM-DD o null si no es una fecha real.
 */
export function leerFechaCelda(valor: unknown): string | null {
  const texto = String(valor ?? '').trim();
  let dia: string | null = null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(texto);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(texto);
  if (iso) dia = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  else if (dmy) dia = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  else if (/[a-z]{3} [a-z]{3} \d{1,2} \d{4}/i.test(texto) && !Number.isNaN(Date.parse(texto))) {
    // Una celda de fecha de Excel llega como Date (medianoche UTC) convertida a texto.
    dia = new Date(texto).toISOString().slice(0, 10);
  }
  return dia && diaAsistenciaSchema.safeParse(dia).success ? dia : null;
}

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
export * from './busqueda';

// --- Parejas Operador CDA + Asistente CDA por día ---

/** Día de la lista de parejas: AAAA-MM-DD de una fecha que existe. */
export const fechaParejaCdaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Fecha inválida');

/** Artículos del kit: "CODIGO" o "CODIGO:SERIE" separados por coma (como la carga masiva de kits). */
export const articulosKitSchema = z.string().trim().max(1000, 'Máximo 1000 caracteres');

/** Motivo para cambiar asignaciones una vez iniciada la jornada (HU12). */
export const justificacionParejaCdaSchema = z.string().trim().max(500, 'Máximo 500 caracteres').optional();

const asistenteDistinto = (d: { operadorCdaId?: string; asistenteCdaId?: string | null }) =>
  !d.asistenteCdaId || d.asistenteCdaId !== d.operadorCdaId;

export const crearParejaCdaSchema = z
  .object({
    fecha: fechaParejaCdaSchema,
    operadorCdaId: z.string().uuid('Elija un operador'),
    asistenteCdaId: z.string().uuid('Asistente inválido').nullable().optional(),
    recintoId: z.string().uuid('Elija un recinto'),
    articulos: articulosKitSchema.optional(),
    justificacion: justificacionParejaCdaSchema,
  })
  .strict()
  .refine(asistenteDistinto, { message: 'El asistente no puede ser el mismo operador', path: ['asistenteCdaId'] });
export type CrearParejaCdaInput = z.infer<typeof crearParejaCdaSchema>;

export const crearKitConParejaCdaSchema = z
  .object({
    eventoId: z.string().uuid('Evento inválido'),
    recintoId: z.string().uuid('Elija un recinto'),
    operadorCdaId: z.string().uuid('Elija un operador'),
    asistenteCdaId: z.string().uuid('Asistente inválido').nullable().optional(),
    detalleItems: z.array(itemKitDetalleSchema).max(100).optional(),
    otroDispositivo: z.boolean().optional(),
    justificacion: justificacionParejaCdaSchema,
  })
  .strict()
  .refine(asistenteDistinto, { message: 'El asistente no puede ser el mismo operador', path: ['asistenteCdaId'] });
export type CrearKitConParejaCdaInput = z.infer<typeof crearKitConParejaCdaSchema>;

export const editarParejaCdaSchema = z
  .object({
    operadorCdaId: z.string().uuid('Operador inválido').optional(),
    asistenteCdaId: z.string().uuid('Asistente inválido').nullable().optional(),
    recintoId: z.string().uuid('Recinto inválido').optional(),
    /** Quien sale de la pareja (operador o asistente reemplazado) pasa a una reserva solo con él o ella. */
    saleAReserva: z.boolean().optional(),
    justificacion: justificacionParejaCdaSchema,
  })
  .strict()
  .refine((d) => Object.keys(d).some((k) => k !== 'justificacion' && k !== 'saleAReserva'), 'Indique qué cambiar')
  .refine(asistenteDistinto, { message: 'El asistente no puede ser el mismo operador', path: ['asistenteCdaId'] });
export type EditarParejaCdaInput = z.infer<typeof editarParejaCdaSchema>;

/** Copiar la lista de parejas de un día a otro (solo se registra; no pasa a la app). */
export const copiarParejasCdaSchema = z
  .object({ desde: fechaParejaCdaSchema, hacia: fechaParejaCdaSchema })
  .strict()
  .refine((d) => d.desde !== d.hacia, { message: 'Elija un día distinto', path: ['hacia'] });
export type CopiarParejasCdaInput = z.infer<typeof copiarParejasCdaSchema>;

/**
 * Intercambia el operador, el asistente o el recinto con otra pareja del
 * mismo día (lo elegido ya era de esa pareja).
 */
export const intercambiarParejaCdaSchema = z
  .object({
    conId: z.string().uuid('Pareja inválida'),
    campo: z.enum(['OPERADOR', 'ASISTENTE', 'RECINTO']),
    justificacion: justificacionParejaCdaSchema,
  })
  .strict();
export type IntercambiarParejaCdaInput = z.infer<typeof intercambiarParejaCdaSchema>;

/** "Asignar a recinto" de una pareja de reserva (si el recinto tiene pareja, se intercambian). */
export const asignarRecintoParejaCdaSchema = z
  .object({ recintoId: z.string().uuid('Elija un recinto'), justificacion: justificacionParejaCdaSchema })
  .strict();
export type AsignarRecintoParejaCdaInput = z.infer<typeof asignarRecintoParejaCdaSchema>;

/** Lo que va en codigo_recinto de la plantilla para dejar la pareja de reserva (sin recinto ni kit). */
export const CODIGO_RESERVA_PAREJAS_CDA = 'RESERVA';

/** "Sin técnico" en el reporte por técnico: recintos con parejas que no están en el distributivo. */
export const SIN_TECNICO_PAREJAS_CDA = 'SIN_TECNICO';

/** ?tecnicos= del reporte por técnico: uno (texto) o varios (repetido) nombres del distributivo, o SIN_TECNICO. */
export const tecnicosReporteParejasCdaSchema = z
  .preprocess(
    (v) => (typeof v === 'string' ? [v] : v),
    z
      .array(z.string().trim().min(1, 'Técnico vacío').max(120, 'Nombre de técnico muy largo'))
      .min(1, 'Elija al menos un técnico')
      .max(30, 'Elija como máximo 30 técnicos'),
  )
  .transform((xs) => [...new Set(xs)]);

export const MAX_FECHAS_HISTORIAL_PAREJAS_CDA = 20;

/** ?fechas= del historial de parejas: una (texto) o varias (repetido), sin repetir y en orden. */
export const fechasHistorialParejasCdaSchema = z
  .preprocess(
    (v) => (typeof v === 'string' ? [v] : v),
    z
      .array(fechaParejaCdaSchema, { required_error: 'Elija al menos una fecha', invalid_type_error: 'Elija al menos una fecha' })
      .min(1, 'Elija al menos una fecha')
      .max(MAX_FECHAS_HISTORIAL_PAREJAS_CDA, `Elija como máximo ${MAX_FECHAS_HISTORIAL_PAREJAS_CDA} fechas`),
  )
  .transform((xs) => [...new Set(xs)].sort());

/** Propuesta automática de parejas para `fecha` a partir de las fechas de referencia. */
export const propuestaParejasCdaSchema = z
  .object({
    fecha: fechaParejaCdaSchema,
    referencia: fechasHistorialParejasCdaSchema,
    extras: z.array(z.string().uuid('Recinto inválido')).max(300, 'Demasiados recintos marcados').default([]),
  })
  .strict()
  .refine((d) => !d.referencia.includes(d.fecha), {
    message: 'La fecha nueva no puede ser una de las de referencia',
    path: ['fecha'],
  });

/** Propuesta editada en la web; las cédulas y códigos se validan como en la plantilla. */
export const cargarPropuestaParejasCdaSchema = z
  .object({
    filas: z
      .array(
        z
          .object({
            cedulaOperador: z.string().trim().max(10, 'Cédula inválida'),
            cedulaAsistente: z.string().trim().max(10, 'Cédula inválida').nullable().optional(),
            codigoRecinto: z.string().trim().max(20, 'Código de recinto muy largo'),
          })
          .strict(),
      )
      .min(1, 'La propuesta no tiene parejas')
      .max(300, 'Máximo 300 parejas'),
    justificacion: justificacionParejaCdaSchema,
  })
  .strict();

const idsPersonasReserva = z.array(z.string().uuid('Persona inválida')).max(300, 'Elija máximo 300 personas');

/** Personas sin pareja ese día que pasan a reserva, cada una por su cuenta. */
export const crearReservasParejaCdaSchema = z
  .object({ fecha: fechaParejaCdaSchema, operadores: idsPersonasReserva, asistentes: idsPersonasReserva })
  .strict()
  .refine((d) => d.operadores.length + d.asistentes.length > 0, { message: 'Elija al menos una persona', path: ['operadores'] })
  .refine((d) => new Set([...d.operadores, ...d.asistentes]).size === d.operadores.length + d.asistentes.length, {
    message: 'Hay personas repetidas',
    path: ['operadores'],
  });

/** Cuerpo de "Aplicar a la app" y de quitar una pareja. */
export const justificacionBodyParejaCdaSchema = z.object({ justificacion: justificacionParejaCdaSchema }).strict();

const textoOpcional = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

/** Lo que falta en una fila sin operador que no es una reserva con asistente. */
export const MENSAJE_FILA_SIN_OPERADOR_CDA = 'Falta el operador: solo una pareja de RESERVA puede ir sin operador, y entonces lleva asistente';

const cedulaOpcional = z.preprocess((v) => (v === '' || v == null ? undefined : v), cedulaSchema.optional());

/**
 * Una fila de la plantilla de parejas (encabezados en snake_case). Una
 * reserva puede ir incompleta: solo el operador o solo el asistente.
 */
export const filaParejaCdaSchema = z
  .object({
    cedula_operador: cedulaOpcional,
    nombre_operador: textoOpcional(200),
    telefono_operador: telefonoSchema,
    cedula_asistente: cedulaOpcional,
    nombre_asistente: textoOpcional(200),
    telefono_asistente: telefonoSchema,
    codigo_recinto: z.string().trim().min(1, 'Código de recinto requerido').max(20, 'Código de recinto muy largo'),
    articulos: textoOpcional(1000),
  })
  .refine((d) => !d.cedula_asistente || d.cedula_asistente !== d.cedula_operador, {
    message: 'El asistente no puede ser el mismo operador',
    path: ['cedula_asistente'],
  })
  .refine(
    (d) => !!d.cedula_operador || (d.codigo_recinto.toUpperCase() === CODIGO_RESERVA_PAREJAS_CDA && !!d.cedula_asistente),
    { message: MENSAJE_FILA_SIN_OPERADOR_CDA, path: ['cedula_operador'] },
  );
export type FilaParejaCdaInput = z.infer<typeof filaParejaCdaSchema>;

// --- Simulador de digitación de actas (práctica tipo SIER) ---

/** Cada cuántas actas se le dice a la persona "digitó 18 de 20". */
export const AVISO_CADA_ACTAS = 20;
export const MAX_FILAS_ACTA_SIMULADOR = 40;
export const MAX_VOTO_SIMULADOR = 999;

const enteroEntre = (min: number, max: number, campo: string) =>
  z
    .number({ invalid_type_error: `${campo} debe ser un número` })
    .int(`${campo} debe ser un número entero`)
    .min(min, `${campo}: mínimo ${min}`)
    .max(max, `${campo}: máximo ${max}`);

const fechaHoraSimuladorSchema = z
  .string({ invalid_type_error: 'Fecha y hora inválidas' })
  .datetime({ offset: true, message: 'Fecha y hora inválidas' });

const idsUnicos = (max: number) =>
  z
    .array(z.string().uuid('Persona inválida'))
    .max(max, `Máximo ${max} personas`)
    .transform((ids) => Array.from(new Set(ids)));

export const practicaDigitacionSchema = z
  .object({
    nombre: z.string().trim().min(3, 'Nombre requerido (mínimo 3 letras)').max(120, 'Máximo 120 caracteres'),
    filasPorActa: enteroEntre(1, MAX_FILAS_ACTA_SIMULADOR, 'Filas por acta'),
    votoMin: enteroEntre(0, MAX_VOTO_SIMULADOR, 'Voto mínimo'),
    votoMax: enteroEntre(0, MAX_VOTO_SIMULADOR, 'Voto máximo'),
    metaActas: enteroEntre(1, 5000, 'Meta de actas'),
    plazoMinutos: enteroEntre(1, 1440, 'Plazo en minutos'),
    inicio: fechaHoraSimuladorSchema,
    fin: fechaHoraSimuladorSchema,
    /** Probabilidad (0-100) de que los dígitos de una fila no coincidan con las letras. */
    pctDigitosDistintos: enteroEntre(0, 100, 'Porcentaje de filas con dígitos distintos'),
    intentosMax: enteroEntre(1, 20, 'Intentos por persona'),
    cargos: z
      .array(grupoCdaSchema)
      .max(40, 'Máximo 40 cargos')
      .transform((c) => Array.from(new Set(c))),
    incluir: idsUnicos(3000),
    excluir: idsUnicos(3000),
  })
  .refine((p) => p.votoMin <= p.votoMax, { message: 'El voto mínimo no puede ser mayor que el máximo', path: ['votoMax'] })
  .refine((p) => Date.parse(p.fin) > Date.parse(p.inicio), { message: 'El fin debe ser posterior al inicio', path: ['fin'] })
  .refine((p) => p.cargos.length > 0 || p.incluir.length > 0, {
    message: 'Elija al menos un cargo o una persona',
    path: ['cargos'],
  })
  .refine((p) => !p.incluir.some((id) => p.excluir.includes(id)), {
    message: 'Una persona no puede estar agregada y quitada a la vez',
    path: ['excluir'],
  });
export type PracticaDigitacionInput = z.infer<typeof practicaDigitacionSchema>;

export const activarPracticaDigitacionSchema = z.object({ activa: z.boolean() });

export const ingresoSimuladorSchema = z.object({ cedula: cedulaSchema });

/** Identificador al azar del navegador (localStorage): desde el mismo equipo se retoma sin esperar. */
export const equipoSimuladorSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/, 'Equipo inválido');
export const iniciarSimuladorSchema = z.object({
  cedula: cedulaSchema,
  practicaId: z.string().uuid('Práctica inválida'),
  equipo: equipoSimuladorSchema.optional(),
});

/** El monitor anula un intento (p. ej. cerraron el navegador por error): el motivo es obligatorio. */
export const anularIntentoSimuladorSchema = z
  .object({ motivo: z.string().trim().min(5, 'Escriba el motivo (mínimo 5 letras)').max(200, 'Máximo 200 caracteres') })
  .strict();
export type AnularIntentoSimuladorInput = z.infer<typeof anularIntentoSimuladorSchema>;

/** Token del intento: 32 bytes en base64url (lo entrega "iniciar"). */
export const tokenSimuladorSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Sesión de práctica inválida'),
});

export const guardarActaSimuladorSchema = tokenSimuladorSchema.extend({
  actaId: z.string().uuid('Acta inválida'),
  valores: z
    .array(z.number().int('Solo números enteros').min(0, 'Solo números de 0 a 999').max(MAX_VOTO_SIMULADOR, 'Solo números de 0 a 999').nullable())
    .min(1, 'El acta no tiene filas')
    .max(MAX_FILAS_ACTA_SIMULADOR, `Máximo ${MAX_FILAS_ACTA_SIMULADOR} filas`),
});
export type GuardarActaSimuladorInput = z.infer<typeof guardarActaSimuladorSchema>;

/** Lo escrito sin guardar (mismo formato que guardar). */
export const borradorActaSimuladorSchema = guardarActaSimuladorSchema;

/** Tras el fin del tiempo, se acepta el último borrador durante este margen (llega tarde por la red). */
export const MARGEN_BORRADOR_MS = 30_000;

export const nombreNovedadDigitacionSchema = z.object({
  nombre: z.string().trim().min(3, 'Nombre requerido (mínimo 3 letras)').max(120, 'Máximo 120 caracteres'),
});
export const activarNovedadDigitacionSchema = z.object({ activa: z.boolean() });

// ─── Simulador: tiempo de cada intento ───────────────────────────────────────

/** Segundos como cronómetro: 1104 → "18:24" (los minutos pueden pasar de 59: "75:00"). */
export function relojSimulador(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Tiempo de un intento, igual en la pantalla de la persona y en los reportes:
 * cumplió → "18:24"; se acabó el tiempo → "25:00 · faltaron 3 actas"; abierto → "En curso"; anulado → "Anulado".
 */
export function textoTiempoIntento(i: {
  segundos: number;
  motivo: 'META' | 'TIEMPO' | null;
  actasFaltantes: number;
  anulado?: boolean;
}): string {
  if (i.anulado) return 'Anulado';
  if (i.motivo === null) return 'En curso';
  const reloj = relojSimulador(i.segundos);
  if (i.motivo === 'META' || i.actasFaltantes <= 0) return reloj;
  return `${reloj} · ${i.actasFaltantes === 1 ? 'faltó 1 acta' : `faltaron ${i.actasFaltantes} actas`}`;
}

// ─── Tiempos de viaje por recinto (bot Jornada) ──────────────────────────────

/** Margen que se suma al viaje más largo medido para sugerir el tiempo de un recinto. */
export const MARGEN_TIEMPO_VIAJE_MIN = 30;
export const MIN_TIEMPO_VIAJE_MIN = 5;
export const MAX_TIEMPO_VIAJE_MIN = 600;

export const minutosTiempoViajeSchema = z
  .number({ invalid_type_error: 'Escriba los minutos' })
  .int('Minutos enteros')
  .min(MIN_TIEMPO_VIAJE_MIN, `Mínimo ${MIN_TIEMPO_VIAJE_MIN} minutos`)
  .max(MAX_TIEMPO_VIAJE_MIN, `Máximo ${MAX_TIEMPO_VIAJE_MIN} minutos (10 horas)`);

/** Guardar uno o varios tiempos de viaje (null = quitar el tiempo del recinto). */
export const guardarTiemposViajeSchema = z
  .object({
    tiempos: z
      .array(z.object({ recintoId: z.string().uuid('Recinto inválido'), minutos: minutosTiempoViajeSchema.nullable() }).strict())
      .min(1, 'Indique al menos un recinto')
      .max(500, 'Máximo 500 recintos por vez'),
  })
  .strict()
  .refine((d) => new Set(d.tiempos.map((t) => t.recintoId)).size === d.tiempos.length, {
    message: 'Un recinto aparece dos veces',
    path: ['tiempos'],
  });
export type GuardarTiemposViajeInput = z.infer<typeof guardarTiemposViajeSchema>;

// ---- Certificados Evatics ----

/**
 * Versión del aviso LOPDP de la página de subida (dice que la foto se envía a
 * un proveedor de IA, Google Gemini o Groq, para leer el nombre). Cambiarla si cambia el texto.
 */
export const VERSION_AVISO_EVATICS = 'LOPDP-EVATICS-2026-11';
export const ESTADOS_CERTIFICADO_EVATICS = ['SIN_SUBIR', 'PENDIENTE', 'APROBADO', 'RECHAZADO'] as const;
export const SIN_CANTON_EVATICS = 'Sin cantón';
export const SIN_TECNICO_EVATICS = 'Sin asistente';

export const consultarEvaticsSchema = z.object({ cedula: cedulaSchema }).strict();

/** Campos de texto que acompañan a la foto (multipart). */
export const subirEvaticsSchema = z.object({
  cedula: cedulaSchema,
  consentimiento: z.literal('true', {
    errorMap: () => ({ message: 'Debe autorizar el tratamiento de la foto para continuar' }),
  }),
  version: z.literal(VERSION_AVISO_EVATICS, {
    errorMap: () => ({ message: 'El aviso cambió: recargue la página y léalo de nuevo' }),
  }),
});

export const revisarEvaticsSchema = z
  .object({
    decision: z.enum(['APROBADO', 'RECHAZADO'], { errorMap: () => ({ message: 'Decisión inválida' }) }),
    motivo: z.string().trim().max(300, 'El motivo no puede pasar de 300 caracteres').optional(),
    /** La foto que vio quien revisa (subidoEn del listado). */
    subidoEn: z.string().datetime({ message: 'Falta la fecha de la foto revisada' }),
  })
  .strict()
  .refine((d) => d.decision !== 'RECHAZADO' || (d.motivo?.length ?? 0) >= 5, {
    message: 'Escriba el motivo del rechazo (mínimo 5 caracteres): la persona lo verá para subir otra foto',
    path: ['motivo'],
  });

export const configEvaticsSchema = z.object({ fechaLimite: diaAsistenciaSchema.nullable() }).strict();

/** Filtros del listado (query). Vacío = sin filtro. */
export const filtrosEvaticsSchema = z.object({
  canton: z.string().trim().max(80).optional(),
  cargo: z.string().trim().max(160).optional(),
  tecnico: z.string().trim().max(160).optional(),
  estado: z.enum(ESTADOS_CERTIFICADO_EVATICS).optional(),
  q: z.string().trim().max(100).optional(),
});
export type FiltrosEvaticsInput = z.infer<typeof filtrosEvaticsSchema>;
