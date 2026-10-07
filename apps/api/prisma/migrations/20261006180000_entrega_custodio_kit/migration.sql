-- Cadena de custodia del kit: entrega del Asistente Electoral Transversal a un
-- militar en el DPEI, historial de correcciones y alerta cuando el CDA recibe
-- un kit sin esa entrega registrada.

CREATE TYPE "campo_correccion_custodia" AS ENUM ('MILITAR', 'OPERADOR');

ALTER TYPE "tipo_alerta" ADD VALUE 'ENTREGA_MILITAR_NO_REGISTRADA';

CREATE TABLE "entregas_custodio_kit" (
    "id" UUID NOT NULL,
    "kit_id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "militar_id" UUID NOT NULL,
    "entregado_por_id" UUID NOT NULL,
    "entregado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "militar_de_otro_recinto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "entregas_custodio_kit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "correcciones_custodia_kit" (
    "id" UUID NOT NULL,
    "kit_id" UUID NOT NULL,
    "campo" "campo_correccion_custodia" NOT NULL,
    "valor_anterior" UUID,
    "valor_nuevo" UUID NOT NULL,
    "motivo" VARCHAR(500) NOT NULL,
    "corregido_por_id" UUID NOT NULL,
    "corregido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correcciones_custodia_kit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "entregas_custodio_kit_kit_id_key" ON "entregas_custodio_kit"("kit_id");
CREATE INDEX "idx_entregas_custodio_evento" ON "entregas_custodio_kit"("evento_id");
CREATE INDEX "idx_correcciones_custodia_kit" ON "correcciones_custodia_kit"("kit_id");

ALTER TABLE "entregas_custodio_kit" ADD CONSTRAINT "entregas_custodio_kit_kit_id_fkey"
  FOREIGN KEY ("kit_id") REFERENCES "kits_electorales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entregas_custodio_kit" ADD CONSTRAINT "entregas_custodio_kit_militar_id_fkey"
  FOREIGN KEY ("militar_id") REFERENCES "militares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
