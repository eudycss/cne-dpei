-- El criterio cambió de "100 % completado" a "cada cuestionario con nota >= 7":
-- se renombra la columna y los valores viejos pasan a "sin dato".
ALTER TABLE "certificados_evatics" RENAME COLUMN "curso_completo" TO "notas_aprobadas";
UPDATE "certificados_evatics" SET "notas_aprobadas" = NULL;
