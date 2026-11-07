-- Simulador: el monitor puede anular un intento (cierre del navegador por
-- error, etc.). El intento anulado se conserva como evidencia y no cuenta para
-- el límite ni para el mejor intento. "equipo_hash" deja retomar al instante
-- desde el mismo navegador. Solo columnas nuevas y opcionales: ninguna fila cambia.
ALTER TABLE "intentos_digitacion"
  ADD COLUMN "anulado_en" TIMESTAMPTZ(6),
  ADD COLUMN "anulado_por_id" UUID,
  ADD COLUMN "motivo_anulacion" VARCHAR(200),
  ADD COLUMN "equipo_hash" VARCHAR(64);

ALTER TABLE "intentos_digitacion"
  ADD CONSTRAINT "intentos_digitacion_anulado_por_id_fkey"
  FOREIGN KEY ("anulado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Anulado = las tres cosas juntas (o ninguna).
ALTER TABLE "intentos_digitacion"
  ADD CONSTRAINT "intentos_digitacion_anulacion_completa"
  CHECK (("anulado_en" IS NULL) = ("anulado_por_id" IS NULL) AND ("anulado_en" IS NULL) = ("motivo_anulacion" IS NULL));
