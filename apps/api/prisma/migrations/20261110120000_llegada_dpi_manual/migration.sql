-- Llegada al DPEI registrada desde la web por un administrador cuando el
-- operador olvidó marcarla en la app: quién la registró y por qué. Columnas
-- nuevas y vacías (sin reescribir la tabla); el resto del historial no cambia.

-- AlterTable
ALTER TABLE "eventos_tracking" ADD COLUMN     "motivo_manual" VARCHAR(500),
ADD COLUMN     "registrado_por_id" UUID;

-- AddForeignKey
ALTER TABLE "eventos_tracking" ADD CONSTRAINT "eventos_tracking_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Solo una llegada al DPEI puede ser manual.
ALTER TABLE "eventos_tracking" ADD CONSTRAINT "ck_eventos_tracking_manual_llegada_dpi"
  CHECK ("motivo_manual" IS NULL OR "tipo" = 'LLEGADA_DPI');

-- Una sola llegada al DPEI por operador y evento: si el operador la marca en
-- la app mientras el administrador la registra, la segunda recibe un 409.
-- En producción no hay duplicados (verificado antes de crear el índice).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tracking_llegada_dpi"
  ON "eventos_tracking" ("evento_id", "operador_id")
  WHERE "tipo" = 'LLEGADA_DPI';
