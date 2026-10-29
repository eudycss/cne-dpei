-- Parejas Operador CDA + Asistente CDA por día y recinto (segunda prueba
-- técnica en adelante). Tabla nueva: no cambia ninguna fila existente.
CREATE TABLE "parejas_cda" (
    "id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "recinto_id" UUID NOT NULL,
    "operador_cda_id" UUID NOT NULL,
    "asistente_cda_id" UUID,
    "kit_id" UUID,
    "articulos" VARCHAR(1000),
    "creado_por_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "parejas_cda_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_parejas_cda_distintos" CHECK ("asistente_cda_id" IS NULL OR "asistente_cda_id" <> "operador_cda_id")
);
CREATE UNIQUE INDEX "uq_parejas_cda_fecha_operador" ON "parejas_cda" ("fecha", "operador_cda_id");
CREATE UNIQUE INDEX "uq_parejas_cda_fecha_asistente" ON "parejas_cda" ("fecha", "asistente_cda_id");
CREATE INDEX "idx_parejas_cda_fecha_recinto" ON "parejas_cda" ("fecha", "recinto_id");
ALTER TABLE "parejas_cda" ADD CONSTRAINT "parejas_cda_recinto_id_fkey"
    FOREIGN KEY ("recinto_id") REFERENCES "recintos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parejas_cda" ADD CONSTRAINT "parejas_cda_operador_cda_id_fkey"
    FOREIGN KEY ("operador_cda_id") REFERENCES "operadores_cda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parejas_cda" ADD CONSTRAINT "parejas_cda_asistente_cda_id_fkey"
    FOREIGN KEY ("asistente_cda_id") REFERENCES "operadores_cda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parejas_cda" ADD CONSTRAINT "parejas_cda_kit_id_fkey"
    FOREIGN KEY ("kit_id") REFERENCES "kits_electorales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "parejas_cda" ADD CONSTRAINT "parejas_cda_creado_por_id_fkey"
    FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
