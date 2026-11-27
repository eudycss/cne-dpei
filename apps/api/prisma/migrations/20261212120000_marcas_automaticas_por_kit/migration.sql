-- Marcas registradas solas por el escaneo del kit: la llegada al recinto (el
-- operador escanea su kit en el recinto) y la salida del recinto (el
-- Asistente Transversal recibe el kit en la DPEI) llevan su motivo, igual que
-- la llegada al DPEI manual. El CHECK anterior solo lo permitía en LLEGADA_DPI.
ALTER TABLE "eventos_tracking" DROP CONSTRAINT IF EXISTS "ck_eventos_tracking_manual_llegada_dpi";
ALTER TABLE "eventos_tracking" ADD CONSTRAINT "ck_eventos_tracking_motivo_manual"
  CHECK ("motivo_manual" IS NULL OR "tipo" IN ('LLEGADA_DPI', 'LLEGADA_RECINTO', 'SALIDA_RECINTO'));

-- Una sola llegada y una sola salida del recinto por operador y evento: si el
-- operador y el escaneo del kit la registran a la vez, la segunda choca aquí
-- (antes solo lo evitaba un findFirst). En producción no hay duplicados
-- (verificado el 2026-11-27 antes de crear los índices).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tracking_llegada_recinto"
  ON "eventos_tracking" ("evento_id", "operador_id")
  WHERE "tipo" = 'LLEGADA_RECINTO';
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tracking_salida_recinto"
  ON "eventos_tracking" ("evento_id", "operador_id")
  WHERE "tipo" = 'SALIDA_RECINTO';
