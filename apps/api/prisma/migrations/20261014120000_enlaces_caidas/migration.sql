-- Historial de caídas de enlaces (inteligencia de negocio: qué recintos se caen más).
-- Una sola migración (atómica): si algo falla no queda a medias.

-- Desde cuándo hay historial. La fila id=1 se asegura aquí: sin ella el
-- servicio tomaría "ahora" como inicio en cada consulta.
ALTER TABLE "config_enlaces" ADD COLUMN "historial_desde" TIMESTAMPTZ(6) NOT NULL DEFAULT now();
INSERT INTO "config_enlaces" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "enlaces_caidas" (
    "id" UUID NOT NULL,
    "codigo_recinto" VARCHAR(20) NOT NULL,
    "nombre_recinto" VARCHAR(255) NOT NULL,
    "canton" VARCHAR(100),
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fin" TIMESTAMPTZ(6),

    CONSTRAINT "enlaces_caidas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_enlaces_caidas_inicio" ON "enlaces_caidas"("inicio");
CREATE INDEX "idx_enlaces_caidas_recinto" ON "enlaces_caidas"("codigo_recinto");

-- A lo más una caída abierta (sin fin) por recinto. Prisma no modela índices
-- parciales; el cron usa createMany con skipDuplicates sobre este índice.
CREATE UNIQUE INDEX "uq_enlaces_caidas_abierta" ON "enlaces_caidas" ("codigo_recinto") WHERE "fin" IS NULL;

-- Los recintos que ya estén caídos al desplegar los abre el primer ciclo del
-- cron (reconciliación), con inicio en ese momento.
