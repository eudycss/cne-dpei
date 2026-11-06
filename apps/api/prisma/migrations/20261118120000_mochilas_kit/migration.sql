-- N.º de mochila ↔ código del QR pegado en ella. Es de la mochila física:
-- vale en todos los eventos (el código del kit se repite por recinto).
CREATE TABLE "mochilas_kit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo_unico" VARCHAR(40) NOT NULL,
    "numero" INTEGER NOT NULL,
    "actualizado_por_id" UUID,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mochilas_kit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mochilas_kit_numero_check" CHECK ("numero" BETWEEN 1 AND 9999)
);

CREATE UNIQUE INDEX "mochilas_kit_codigo_unico_key" ON "mochilas_kit"("codigo_unico");

CREATE UNIQUE INDEX "mochilas_kit_numero_key" ON "mochilas_kit"("numero");
