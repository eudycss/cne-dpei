-- Asistentes CDA: el personal de los CDA se divide en dos grupos con la misma
-- gestión (listado, asistencia, QR, atrasos, actas). Todo lo existente queda
-- como OPERADOR. La cédula sigue siendo única: una persona, un solo grupo.
CREATE TYPE "grupo_cda" AS ENUM ('OPERADOR', 'ASISTENTE');

ALTER TABLE "operadores_cda" ADD COLUMN "grupo" "grupo_cda" NOT NULL DEFAULT 'OPERADOR';
CREATE INDEX "operadores_cda_grupo_activo_idx" ON "operadores_cda" ("grupo", "activo");

-- Hora de entrada y gracia propias por grupo: la fila única (id = 1) pasa a
-- ser la de OPERADOR y la llave es ahora el grupo.
ALTER TABLE "config_asistencia_cda" ADD COLUMN "grupo" "grupo_cda" NOT NULL DEFAULT 'OPERADOR';
ALTER TABLE "config_asistencia_cda" DROP CONSTRAINT "ck_config_asistencia_cda_singleton";
ALTER TABLE "config_asistencia_cda" DROP CONSTRAINT "config_asistencia_cda_pkey";
ALTER TABLE "config_asistencia_cda" DROP COLUMN "id";
ALTER TABLE "config_asistencia_cda" ALTER COLUMN "grupo" DROP DEFAULT;
ALTER TABLE "config_asistencia_cda" ADD CONSTRAINT "config_asistencia_cda_pkey" PRIMARY KEY ("grupo");
