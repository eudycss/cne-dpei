-- Cargos del personal CDA: además de Operadores y Asistentes, seis grupos
-- nuevos con la misma gestión (listado, asistencia, QR, atrasos, actas).
-- Solo se agregan valores al enum: no cambia ninguna fila existente. Cada
-- grupo nuevo usa la hora y gracia por defecto hasta que se configure.
ALTER TYPE "grupo_cda" ADD VALUE IF NOT EXISTS 'DIGITADOR';
ALTER TYPE "grupo_cda" ADD VALUE IF NOT EXISTS 'ASISTENTE_ARCHIVOS';
ALTER TYPE "grupo_cda" ADD VALUE IF NOT EXISTS 'ASISTENTE_FIRMAS';
ALTER TYPE "grupo_cda" ADD VALUE IF NOT EXISTS 'RECEPTOR_ACTAS';
ALTER TYPE "grupo_cda" ADD VALUE IF NOT EXISTS 'SUPERVISOR';
ALTER TYPE "grupo_cda" ADD VALUE IF NOT EXISTS 'OPERADOR_ESCANER_CPE';
