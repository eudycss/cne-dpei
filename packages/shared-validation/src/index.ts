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
