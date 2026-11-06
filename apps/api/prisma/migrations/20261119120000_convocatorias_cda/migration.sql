-- Convocatoria del día: a quién se llamó (además de quienes están en Parejas
-- esa fecha). Solo los convocados pueden tener falta en la asistencia.
CREATE TABLE "convocatorias_cda" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fecha" DATE NOT NULL,
    "operador_id" UUID NOT NULL,
    "creado_por_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convocatorias_cda_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_convocatorias_cda_fecha_operador" ON "convocatorias_cda"("fecha", "operador_id");

CREATE INDEX "idx_convocatorias_cda_operador" ON "convocatorias_cda"("operador_id");

ALTER TABLE "convocatorias_cda" ADD CONSTRAINT "convocatorias_cda_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "operadores_cda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
