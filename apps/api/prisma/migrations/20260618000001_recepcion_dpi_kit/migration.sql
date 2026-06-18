-- CreateTable
CREATE TABLE "recepciones_dpi_kit" (
    "id" UUID NOT NULL,
    "kit_id" UUID NOT NULL,
    "supervisor_id" UUID NOT NULL,
    "items" JSONB NOT NULL,
    "observaciones" VARCHAR(500),
    "confirmado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recepciones_dpi_kit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_recepciones_dpi_kit" ON "recepciones_dpi_kit"("kit_id");
