-- Militares ocultos (activo = false): no salen en listados, app ni actas;
-- sus entregas pasadas (cadena de custodia) se conservan.
ALTER TABLE "militares" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "idx_militares_recinto_activo" ON "militares"("recinto_id", "activo");
