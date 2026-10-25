-- Cambiar de cargo a una persona del CDA sin mover su historia:
-- 1) cambios_cargo_cda guarda desde qué día rige cada cambio, para saber en
--    qué cargo estaba cada día (reportes de asistencia y atrasos).
-- 2) Cada acta guarda el cargo con el que se generó: un acta firmada como
--    ASISTENTE CDA no debe salir como OPERADOR CDA al descargarla después.
CREATE TABLE "cambios_cargo_cda" (
    "id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "grupo_anterior" "grupo_cda" NOT NULL,
    "grupo_nuevo" "grupo_cda" NOT NULL,
    "desde" DATE NOT NULL,
    "hecho_por_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cambios_cargo_cda_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_cambios_cargo_cda_distinto" CHECK ("grupo_anterior" <> "grupo_nuevo")
);
CREATE INDEX "idx_cambios_cargo_cda_operador" ON "cambios_cargo_cda" ("operador_id", "desde");
CREATE INDEX "idx_cambios_cargo_cda_anterior" ON "cambios_cargo_cda" ("grupo_anterior");
CREATE INDEX "idx_cambios_cargo_cda_nuevo" ON "cambios_cargo_cda" ("grupo_nuevo");
ALTER TABLE "cambios_cargo_cda" ADD CONSTRAINT "cambios_cargo_cda_operador_id_fkey"
    FOREIGN KEY ("operador_id") REFERENCES "operadores_cda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cambios_cargo_cda" ADD CONSTRAINT "cambios_cargo_cda_hecho_por_id_fkey"
    FOREIGN KEY ("hecho_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Actas existentes: el cargo actual de la persona (nadie ha cambiado de cargo aún).
ALTER TABLE "actas_entrega_cda" ADD COLUMN "grupo" "grupo_cda";
UPDATE "actas_entrega_cda" a SET "grupo" = o."grupo" FROM "operadores_cda" o WHERE o."id" = a."operador_id";
ALTER TABLE "actas_entrega_cda" ALTER COLUMN "grupo" SET NOT NULL;
