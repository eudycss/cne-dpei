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
export const createRecintoSchema = z.object({
  codigoRecinto: z.string().min(1, 'Requerido').max(20, 'Máximo 20 caracteres'),
  nombre: z.string().min(1, 'Requerido').max(255, 'Máximo 255 caracteres'),
  direccion: z.string().max(255).nullable().optional(),
  cantonId: z.number().int('Selecciona un cantón').positive('Selecciona un cantón'),
  parroquia: z.string().max(120).nullable().optional(),
  zona: z.string().max(120).nullable().optional(),
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
  codigo_recinto: z.string().min(1, 'Código requerido'),
  nombre: z.string().min(1, 'Nombre requerido'),
  canton_codigo: z.string().min(1, 'Código de cantón requerido'),
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
  cda_destino_codigo: z.string().optional(),
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

export const configAlertasSchema = z.object({
  umbralLlegadaRecintoMin: z.number().int().min(1).max(1440),
  umbralLlegadaDpiMin: z.number().int().min(1).max(1440),
  umbralSinSyncMin: z.number().int().min(1).max(1440),
  margenLlegadaMetros: z.number().int().min(10).max(50000),
});

export const closeEventoSchema = z.object({
  confirmar: z.literal(true, {
    errorMap: () => ({ message: 'Debes confirmar el cierre del evento' }),
  }),
  justificacion: z.string().max(1000).optional(),
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
export const createKitSchema = z.object({
  eventoId: z.string().uuid('Evento inválido'),
  nombre: z.string().min(1, 'Requerido').max(160),
  contenidos: z.string().max(1000).nullable().optional(),
  esPrueba: z.boolean().optional(),
});

export const pdfQrSchema = z.object({
  kitIds: z.array(z.string().uuid()).min(1, 'Selecciona al menos un kit').max(200),
});

export const asignarKitSchema = z.object({
  operadorId: z.string().uuid('Operador inválido'),
  recintoId: z.string().uuid('Recinto inválido'),
  justificacion: z.string().max(500).optional(),
});

// HU12-CA6: justificación excepcional para modificar asignaciones con el
// evento ya congelado (jornada electoral iniciada).
export const desasignarKitSchema = z.object({
  justificacion: z.string().max(500).optional(),
});

// Fila de Excel/CSV para carga masiva de kits. El código único se autogenera;
// el operador se referencia por su cédula y el recinto por su código.
// La asignación es opcional: si se omiten ambos, el kit queda en bodega.
export const bulkKitRowSchema = z
  .object({
    nombre: z.string().min(1, 'Nombre requerido').max(160),
    contenidos: z.string().max(1000).optional(),
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
export type DesasignarKitInput = z.infer<typeof desasignarKitSchema>;
export type BulkKitRow = z.infer<typeof bulkKitRowSchema>;

// ===================================================================
// FASE 4 — Tracking del operador (HU2)
// ===================================================================
export const salidaDpiSchema = z.object({
  latitud: z.number().min(-90).max(90),
  longitud: z.number().min(-180).max(180),
  ocurridoEn: z
    .string()
    .datetime({ message: 'Fecha-hora ISO requerida' }),
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
});

export const llegadaRecintoSchema = z.object({
  latitud: z.number().min(-90).max(90),
  longitud: z.number().min(-180).max(180),
  ocurridoEn: z.string().datetime({ message: 'Fecha-hora ISO requerida' }),
  precisionMetros: z.number().nonnegative().nullable().optional(),
});

export const llegadaNoCdaSchema = z.object({
  recintoId: z.string().uuid(),
});

export const llegadaRecintoManualSchema = z.object({
  recintoId: z.string().uuid(),
});

// HU4 — Salida del recinto y rastreo continuo
export const salidaRecintoSchema = z.object({
  latitud: z.number().min(-90).max(90),
  longitud: z.number().min(-180).max(180),
  ocurridoEn: z.string().datetime({ message: 'Fecha-hora ISO requerida' }),
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
});

// Verificación de kits al retorno al DPI (rol TECNICO_SUPERVISOR)
export const itemChecklistSchema = z.object({
  texto: z.string().min(1),
  marcado: z.boolean(),
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
