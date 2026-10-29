-- Cargo nuevo del personal CPE: Archivador de actas, con la misma gestión
-- que los demás. Solo agrega un valor al enum: no cambia ninguna fila.
ALTER TYPE "grupo_cda" ADD VALUE IF NOT EXISTS 'ARCHIVADOR_ACTAS';
