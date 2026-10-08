-- Prueba de conexión: el operador CDA confirma a la vista que el recinto tiene
-- conexión, después de la llegada al recinto. Se guarda como un hito más de
-- eventos_tracking (sale en el Informe del Operador CDA).

ALTER TYPE "tipo_tracking" ADD VALUE IF NOT EXISTS 'PRUEBA_CONEXION';
