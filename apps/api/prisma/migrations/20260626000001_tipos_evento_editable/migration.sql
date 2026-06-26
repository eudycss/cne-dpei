-- CreateTable tipos_evento_electoral (catálogo editable)
CREATE TABLE "tipos_evento_electoral" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "codigo" VARCHAR(50) NOT NULL,
  "etiqueta" VARCHAR(120) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "tipos_evento_electoral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tipos_evento_electoral_codigo_key" ON "tipos_evento_electoral"("codigo");

-- Seed con los 6 tipos existentes
INSERT INTO "tipos_evento_electoral" ("codigo", "etiqueta") VALUES
  ('ELECCION_GENERAL', 'Elección General'),
  ('SEGUNDA_VUELTA', 'Segunda Vuelta'),
  ('CONSULTA_POPULAR', 'Consulta Popular'),
  ('REFERENDUM', 'Referéndum'),
  ('ELECCIONES_SECCIONALES', 'Elecciones Seccionales'),
  ('OTRO', 'Otro');

-- Cambiar columna tipo de enum a varchar (conservando los valores actuales)
ALTER TABLE "eventos_electorales"
  ALTER COLUMN "tipo" TYPE VARCHAR(50)
  USING "tipo"::text;

-- Eliminar el enum de PostgreSQL
DROP TYPE "tipo_evento_electoral";
