import { z } from 'zod';

// Política de contraseña fuerte (HU1-CA3)
// - Mínimo 12 caracteres
// - Al menos una mayúscula, una minúscula, un dígito y un carácter especial
export const strongPasswordSchema = z
  .string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres')
  .max(128, 'La contraseña no puede exceder 128 caracteres')
  .refine((v) => /[A-Z]/.test(v), 'Debe incluir al menos una mayúscula')
  .refine((v) => /[a-z]/.test(v), 'Debe incluir al menos una minúscula')
  .refine((v) => /\d/.test(v), 'Debe incluir al menos un dígito')
  .refine(
    (v) => /[^A-Za-z0-9]/.test(v),
    'Debe incluir al menos un carácter especial',
  );

// Cédula ecuatoriana: 10 dígitos (validación básica de longitud y dígitos)
export const cedulaSchema = z
  .string()
  .regex(/^\d{10}$/, 'La cédula debe tener exactamente 10 dígitos');

export const emailSchema = z
  .string()
  .email('Email inválido')
  .max(255, 'El email no puede exceder 255 caracteres');

export const nombreSchema = z
  .string()
  .min(1, 'Requerido')
  .max(120, 'Máximo 120 caracteres');

export const telefonoSchema = z.preprocess(
  // Cadena vacía (celda de Excel/CSV vacía) se trata como ausente
  (v) => (v === '' || v === null ? undefined : v),
  z
    .string()
    .regex(/^[\d+\-\s()]{7,20}$/, 'Teléfono inválido')
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

// --- Eventos electorales (HU20) ---
export const tipoEventoEnum = z.enum([
  'ELECCION_GENERAL',
  'SEGUNDA_VUELTA',
  'CONSULTA_POPULAR',
  'REFERENDUM',
  'OTRO',
]);

export const createEventoSchema = z.object({
  nombre: z.string().min(1, 'Requerido').max(160),
  tipo: tipoEventoEnum,
  fechaJornada: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)'),
  descripcion: z.string().max(2000).nullable().optional(),
});

export const updateEventoSchema = z.object({
  nombre: z.string().min(1).max(160).optional(),
  tipo: tipoEventoEnum.optional(),
  fechaJornada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  descripcion: z.string().max(2000).nullable().optional(),
});

export const configAlertasSchema = z.object({
  umbralLlegadaRecintoMin: z.number().int().min(1).max(1440),
  umbralLlegadaDpiMin: z.number().int().min(1).max(1440),
  umbralSinSyncMin: z.number().int().min(1).max(1440),
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

// --- Kits electorales (HU11) ---
export const createKitSchema = z.object({
  eventoId: z.string().uuid('Evento inválido'),
  nombre: z.string().min(1, 'Requerido').max(160),
  contenidos: z.string().max(1000).nullable().optional(),
});

export const pdfQrSchema = z.object({
  kitIds: z.array(z.string().uuid()).min(1, 'Selecciona al menos un kit').max(200),
});

export type CreateKitInput = z.infer<typeof createKitSchema>;

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

export type CreateMilitarInput = z.infer<typeof createMilitarSchema>;
export type BulkMilitarRow = z.infer<typeof bulkMilitarRowSchema>;
export type CreateEventoInput = z.infer<typeof createEventoSchema>;
export type ConfigAlertasInput = z.infer<typeof configAlertasSchema>;
export type UpsertAsignacionInput = z.infer<typeof upsertAsignacionSchema>;
