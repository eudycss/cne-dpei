-- Informe de productos del personal CDA/CPE: visitas a la página pública y
-- las 6 fotos del registro fotográfico (anexo).
CREATE TABLE "visitas_informe_cda" (
    "id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visitas_informe_cda_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "visitas_informe_cda_token_hash_key" ON "visitas_informe_cda"("token_hash");
CREATE INDEX "idx_visitas_informe_cda_expira" ON "visitas_informe_cda"("expira_en");
ALTER TABLE "visitas_informe_cda" ADD CONSTRAINT "visitas_informe_cda_operador_id_fkey"
    FOREIGN KEY ("operador_id") REFERENCES "operadores_cda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fotos_informe_cda" (
    "id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "posicion" INTEGER NOT NULL,
    "foto_key" VARCHAR(255) NOT NULL,
    "ancho" INTEGER NOT NULL,
    "alto" INTEGER NOT NULL,
    "visita_id" UUID,
    "consentimiento_version" VARCHAR(40) NOT NULL,
    "subido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fotos_informe_cda_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_fotos_informe_cda_posicion" CHECK ("posicion" BETWEEN 1 AND 6),
    CONSTRAINT "ck_fotos_informe_cda_medidas" CHECK ("ancho" > 0 AND "alto" > 0)
);
CREATE UNIQUE INDEX "fotos_informe_cda_operador_id_posicion_key" ON "fotos_informe_cda"("operador_id", "posicion");
ALTER TABLE "fotos_informe_cda" ADD CONSTRAINT "fotos_informe_cda_operador_id_fkey"
    FOREIGN KEY ("operador_id") REFERENCES "operadores_cda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fotos_informe_cda" ADD CONSTRAINT "fotos_informe_cda_visita_id_fkey"
    FOREIGN KEY ("visita_id") REFERENCES "visitas_informe_cda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
